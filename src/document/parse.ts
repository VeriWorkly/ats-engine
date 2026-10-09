import { parseCertifications } from "../parser/certifications.js";
import { educationLevel } from "../parser/education.js";
import { canonicalLanguage, cefrLevel, parseSpokenLanguages } from "../parser/languages.js";
import { findPhone } from "../parser/phone.js";
import { parseDocumentDate } from "../parser/dates.js";
import { finalizeParsed } from "../parser/record.js";
import { sectionKind } from "../parser/sections.js";
import type { AtsEnginePolicy } from "../policy/schema.js";
import type {
  AtsParsedCertification,
  AtsParsedEducation,
  AtsParsedLanguage,
  AtsParsedResume,
  AtsParsedRole,
} from "../types.js";
import type { AtsResumeDocument } from "./types.js";

const dateValue = (date: { year: number; month: number | null } | null, fallbackMonth: number) =>
  date ? date.year * 12 + (date.month ?? fallbackMonth) : null;

/**
 * The recovered record for a structured document, read from its fields rather than parsed.
 *
 * Nothing here is inferred: a role's title is the title field, its dates are the date fields.
 * Only the degree level is classified, from the credential text, because the document names a
 * credential ("MSc Data Science") rather than a level.
 *
 * Every experience-kind section contributes roles. Sections an ATS files separately —
 * volunteering, certifications — never count toward tenure. Certifications and languages are
 * read from their own sections' fields, or from an `other` section titled as one; only a
 * language's CEFR level is classified, from its level text.
 */
export function parseResumeDocument(
  doc: AtsResumeDocument,
  policy: AtsEnginePolicy,
  now: Date,
): AtsParsedResume {
  const rp = policy.resumeParse;
  const roles: AtsParsedRole[] = [];
  const education: AtsParsedEducation[] = [];
  const skills: string[] = [];
  const certifications: AtsParsedCertification[] = [];
  const spokenLanguages: AtsParsedLanguage[] = [];

  for (const section of doc.sections) {
    if (section.kind === "experience") {
      for (const item of section.items) {
        const title = item.title.trim();
        const employer = item.employer.trim();
        if (!title && !employer) continue;
        const current = Boolean(item.current);
        roles.push({
          title,
          employer,
          start: parseDocumentDate(item.start, rp, now),
          end: current ? null : parseDocumentDate(item.end, rp, now),
          current,
        });
      }
    } else if (section.kind === "education") {
      for (const item of section.items) {
        const school = item.school.trim();
        const credential = [item.credential?.trim(), item.field?.trim()]
          .filter(Boolean)
          .join(" in ");
        if (!school && !credential) continue;
        education.push({
          school,
          credential,
          ...educationLevel(credential, policy),
          end: item.current ? null : parseDocumentDate(item.end, rp, now),
        });
      }
    } else if (section.kind === "skills") {
      for (const group of section.items) {
        const keywords = group.keywords.map((keyword) => keyword.trim()).filter(Boolean);
        // A group with no keywords is itself the skill ("Kubernetes" with no sub-list).
        if (keywords.length) skills.push(...keywords);
        else if (group.name?.trim()) skills.push(group.name.trim());
      }
    } else if (section.kind === "certifications") {
      for (const item of section.items) {
        const name = item.name.trim();
        if (!name || certifications.some((row) => row.name.toLowerCase() === name.toLowerCase()))
          continue;
        certifications.push({
          name,
          issuer: item.issuer?.trim() ?? "",
          date: parseDocumentDate(item.date, rp, now),
          expires: parseDocumentDate(item.expires, rp, now),
        });
      }
    } else if (section.kind === "languages") {
      // A language field names a language whatever it is called; only its level is read.
      for (const item of section.items) {
        const language = item.language.trim();
        const key = canonicalLanguage(language, policy);
        if (
          !language ||
          spokenLanguages.some((row) => canonicalLanguage(row.language, policy) === key)
        )
          continue;
        const level = item.level?.trim() ?? "";
        spokenLanguages.push({ language, level, cefr: level ? cefrLevel(level, policy) : null });
      }
    } else if (section.kind === "other") {
      // An `other` section titled as one ("Licenses & Certifications", "Languages") is read as
      // the text parser reads that section: each entry's heading, or its lines when it has none.
      const kind = sectionKind(section.title, policy);
      if (kind !== "certifications" && kind !== "languages") continue;
      const lines = section.items.flatMap((entry) =>
        entry.heading?.trim() ? [entry.heading] : (entry.lines ?? []),
      );
      if (kind === "languages") parseSpokenLanguages(lines, policy, spokenLanguages);
      else
        for (const row of parseCertifications(lines, policy, now))
          if (!certifications.some((kept) => kept.name.toLowerCase() === row.name.toLowerCase()))
            certifications.push(row);
    }
  }

  for (const role of roles) {
    const start = dateValue(role.start, 1);
    const end = dateValue(role.end, 12);
    if (start !== null && end !== null && start > end) {
      role.start = null;
      role.end = null;
    }
  }

  const { basics } = doc;
  return finalizeParsed(
    {
      name: basics.name.trim(),
      email: basics.email?.trim() ?? "",
      // Held to the check a printed number is: a field reading "0000000000" is not a phone an
      // ATS would file, and the structured path must not credit what the text path would not.
      phone: basics.phone ? findPhone(basics.phone, policy, now) : "",
      links: (basics.links ?? []).map((link) => link.trim()).filter(Boolean),
      roles,
      education,
      skills: skills.filter((skill) => skill.length <= 60),
      certifications,
      spokenLanguages,
    },
    () => "structured",
    now,
  );
}
