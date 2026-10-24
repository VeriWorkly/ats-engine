import { addCertifications, parseCertifications } from "../parser/certifications.js";
import { educationLevel } from "../parser/education.js";
import { isSkillItem } from "../matching/vocabulary.js";
import { canonicalLanguage, cefrLevel, parseSpokenLanguages } from "../parser/languages.js";
import { findPhone } from "../parser/phone.js";
import { parseDocumentDate, saysOngoing } from "../parser/dates.js";
import { isLeave } from "../parser/experience.js";
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
import { monthIndex } from "../util/months.js";
import type { AtsResumeDocument } from "./types.js";

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
        // Time off is no role, as in printed text: "Parental leave", "Elternzeit".
        if ((!title && !employer) || isLeave(title, employer, policy)) continue;
        const start = parseDocumentDate(item.start, rp, now);
        const end = parseDocumentDate(item.end, rp, now, "end");
        // An end that is no date but an open end in any language read ("heute", "Current role").
        const current =
          Boolean(item.current) || (start !== null && !end && saysOngoing(item.end, rp));
        roles.push({ title, employer, start, end: current ? null : end, current });
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
          end:
            item.current || saysOngoing(item.end, rp)
              ? null
              : parseDocumentDate(item.end, rp, now, "end"),
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
            expires: parseDocumentDate(item.expires, rp, now, "end"),
          },
        ]);
      }
    } else if (section.kind === "languages") {
      for (const item of section.items) {
        const language = item.language.trim();
        const key = canonicalLanguage(language, policy);
        // A programming language or other skill ("Python", "C++") is no spoken language, as in text.
        if (
          !language ||
          spokenLanguages.some((row) => canonicalLanguage(row.language, policy) === key) ||
          isSkillItem(language, policy.keywordMatch)
        )
          continue;
        const level = item.level?.trim() ?? "";
        spokenLanguages.push({
          language,
          level,
          cefr: level ? cefrLevel(level, policy, true) : null,
        });
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

  for (const role of roles)
    if (role.start && role.end && monthIndex(role.start) > monthIndex(role.end, 12)) {
      role.start = null;
      role.end = null;
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
