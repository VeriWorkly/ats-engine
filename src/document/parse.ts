import { addCertifications, parseCertifications } from "../parser/certifications.js";
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
 * The recovered record for a structured document, read from its fields rather than parsed. Only
 * the degree level (from the credential text) and a language's CEFR level are classified.
 * Certifications and languages also come from an `other` section titled as one; other sections
 * an ATS files separately never count toward tenure.
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
        // A group without keywords is itself the skill.
        if (keywords.length) skills.push(...keywords);
        else if (group.name?.trim()) skills.push(group.name.trim());
      }
    } else if (section.kind === "certifications") {
      for (const item of section.items) {
        const name = item.name.trim();
        if (!name) continue;
        addCertifications(certifications, [
          {
            name,
            issuer: item.issuer?.trim() ?? "",
            date: parseDocumentDate(item.date, rp, now),
            expires: parseDocumentDate(item.expires, rp, now),
          },
        ]);
      }
    } else if (section.kind === "languages") {
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
      // Read as the text parser reads that section: each entry's heading, or its lines without one.
      const kind = sectionKind(section.title, policy);
      if (kind !== "certifications" && kind !== "languages") continue;
      const lines = section.items.flatMap((entry) =>
        entry.heading?.trim() ? [entry.heading] : (entry.lines ?? []),
      );
      if (kind === "languages") parseSpokenLanguages(lines, policy, spokenLanguages);
      else addCertifications(certifications, parseCertifications(lines, policy, now));
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
      // Held to the same check as printed text: "0000000000" is not a phone.
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
