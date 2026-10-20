import type { AtsEnginePolicy } from "../policy/schema.js";
import type { AtsParsedCertification, AtsParsedLanguage, AtsParsedResume } from "../types.js";
import {
  addCertifications,
  parseCertificationList,
  parseCertifications,
} from "./certifications.js";
import { EMAIL, LINK, findName } from "./contact.js";
import { findDateRange, readingDatesAt } from "./dates.js";
import { degreeLevel, parseEducation } from "./education.js";
import { BULLET, BULLET_PREFIX } from "../text/text.js";
import { opensWithVerb, parseRoles, titleWordsOf } from "./experience.js";
import { parseSpokenLanguages, readLanguages } from "./languages.js";
import { finalizeParsed } from "./record.js";
import { readResumeLines } from "./lines.js";
import { findPhone } from "./phone.js";
import {
  labelledLine,
  segmentResume,
  type ResumeSection,
  type ResumeSectionKind,
} from "./sections.js";

/** The category label on a skills line ("Languages: "); the space after the colon keeps "https://…" whole. */
const SKILL_LABEL = /^[^:,;|]{1,40}:\s+/;

/** What separates one skill from the next: a list punctuation mark, or a column gap. */
const SKILL_SEPARATOR = /[,;|•·]|\s{2,}/g;

/**
 * A skills line cut at its separators, except inside brackets ("AWS (EC2, S3)" is one skill). A
 * bracket that never closes does not swallow the rest of the line.
 */
function splitSkills(line: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let from = 0;
  let scanned = 0;
  const scanTo = (end: number) => {
    for (; scanned < end; scanned += 1) {
      const char = line[scanned];
      if (char === "(" || char === "[") depth += 1;
      else if ((char === ")" || char === "]") && depth > 0) depth -= 1;
    }
  };
  for (const match of line.matchAll(SKILL_SEPARATOR)) {
    scanTo(match.index);
    if (depth > 0) continue;
    parts.push(line.slice(from, match.index));
    from = match.index + match[0].length;
  }
  scanTo(line.length);
  if (depth > 0) return line.split(SKILL_SEPARATOR);
  parts.push(line.slice(from));
  return parts;
}

/**
 * The certification and spoken-language rows, in page order: from their own sections and from a
 * labelled line among the skills ("Languages: English (native)"). What such a line names as rows
 * is not also a skill, so `skillLines` holds the line without it ("Languages: English, Python"
 * leaves "Python"); "Languages: Go, Rust" names no language and stays a skills line whole.
 */
function readCredentialRows(
  sections: readonly ResumeSection[],
  policy: AtsEnginePolicy,
  now: Date,
) {
  const certifications: AtsParsedCertification[] = [];
  const spokenLanguages: AtsParsedLanguage[] = [];
  const skillLines = new Map<string, string>();
  for (const section of sections) {
    if (section.kind === "certifications")
      addCertifications(certifications, parseCertifications(section.lines, policy, now));
    else if (section.kind === "languages")
      parseSpokenLanguages(section.lines, policy, spokenLanguages);
    else if (section.kind === "skills")
      for (const line of section.lines) {
        const labelled = labelledLine(line.replace(BULLET_PREFIX, ""), policy);
        if (labelled?.kind === "languages" && readLanguages(labelled.rest, policy).rows.length) {
          parseSpokenLanguages([labelled.rest], policy, spokenLanguages);
          const others = splitSkills(labelled.rest).filter(
            (item) => !readLanguages(item, policy).rows.length,
          );
          skillLines.set(line, others.join(", "));
        } else if (labelled?.kind === "certifications") {
          const rows = parseCertificationList(labelled.rest, policy, now);
          if (rows.length) skillLines.set(line, "");
          addCertifications(certifications, rows);
        }
      }
  }
  return { certifications, spokenLanguages, skillLines };
}

/**
 * Recovers the fields an applicant tracking system stores (name, contact, one row per job) from
 * plain text. Parses representatively, not perfectly: a field it cannot find is itself the
 * finding. Deterministic; no model.
 */
export function parseResume(
  lines: string[],
  policy: AtsEnginePolicy,
  now = new Date(),
): AtsParsedResume {
  return parseReadLines(readResumeLines(lines, policy).lines, policy, readingDatesAt(now));
}

/**
 * The resume's sections, with the name's line opening a block of its own when the name was read
 * over a headline further down (a LinkedIn export's sidebar leaves name, headline and city under
 * its last heading). A name taken from a list's rows, or the first line under its heading, is
 * one of those rows and cuts nothing.
 */
export function readSections(lines: string[], policy: AtsEnginePolicy): ResumeSection[] {
  const sections = segmentResume(lines, policy);
  const { name, headlined } = findName(lines, policy);
  if (!headlined) return sections;
  const at = sections.findIndex((section) => section.lines.some((line) => line.trim() === name));
  const section = sections[at];
  if (!section?.headed) return sections;
  const cut = section.lines.findIndex((line) => line.trim() === name);
  if (cut === 0) return sections;
  return [
    ...sections.slice(0, at),
    { ...section, lines: section.lines.slice(0, cut) },
    { kind: "other", lines: section.lines.slice(cut), headed: false },
    ...sections.slice(at + 1),
  ];
}

/** `parseResume` on lines already through `readResumeLines` (and sections already read, if given). */
export function parseReadLines(
  lines: string[],
  policy: AtsEnginePolicy,
  now: Date,
  sections = readSections(lines, policy),
): AtsParsedResume {
  const joined = lines.join("\n");
  const { name } = findName(lines, policy);

  const take = (kind: ResumeSectionKind) =>
    sections.filter((section) => section.kind === kind).flatMap((section) => section.lines);

  const experienceLines = take("experience");
  // Without an Experience heading, read every block not known to hold something else (a degree's
  // "2010 - 2014" is not a role).
  const roles = parseRoles(
    experienceLines.length
      ? experienceLines
      : sections
          .filter(
            (section) =>
              !["education", "skills", "projects", "certifications", "languages"].includes(
                section.kind,
              ),
          )
          .flatMap((section) => section.lines),
    policy,
    now,
  );
  // Without an Education heading, read every block that can hold a degree, never a bullet ("Ran a
  // PhD intern program"). From work history, skills and projects take only a line naming a degree
  // and the school line beside it, not a role's dated header ("MBA Intern, Goldman Sachs  2019").
  const education = parseEducation(
    take("education").length
      ? take("education")
      : sections.flatMap((section) => {
          const body = section.lines.filter((line) => !BULLET.test(line));
          if (!["experience", "skills", "projects"].includes(section.kind)) return body;
          const titleWords = titleWordsOf(policy);
          const role = body.map(
            (line) =>
              opensWithVerb(line, policy) ||
              (titleWords.test(line) && findDateRange(line, policy.resumeParse, now) !== null),
          );
          const degree = body.map((line, at) => !role[at] && degreeLevel(line, policy) !== null);
          return body.filter(
            (_, at) => !role[at] && (degree[at] || degree[at - 1] || degree[at + 1]),
          );
        }),
    policy,
    now,
  );

  const { certifications, spokenLanguages, skillLines } = readCredentialRows(sections, policy, now);
  const skills = take("skills")
    .flatMap((line) =>
      splitSkills(skillLines.get(line) ?? line.replace(BULLET_PREFIX, "").replace(SKILL_LABEL, "")),
    )
    .map((skill) => skill.replace(BULLET_PREFIX, "").trim())
    .filter(
      (skill) =>
        // One letter is a skill only as a capital (R, C), not a stray "o".
        (skill.length > 1 || /^\p{Lu}$/u.test(skill)) &&
        skill.length <= 60 &&
        // A date or number is not a skill, nor is an address.
        /\p{L}/u.test(skill) &&
        !/^(?:https?:\/\/|www\.)|@/i.test(skill),
    );

  return finalizeParsed(
    {
      name,
      email: joined.match(EMAIL)?.[0] ?? "",
      phone: findPhone(joined, policy, now),
      links: (joined.match(LINK) ?? []).map((link) =>
        link.replace(/(?<![).,;:!?'"])[).,;:!?'"]+$/, ""),
      ),
      roles,
      education,
      skills,
      certifications,
      spokenLanguages,
    },
    () => "parser",
    now,
  );
}

/**
 * How much of what an ATS needs was recoverable. `roleCompleteness` matters most: a job row
 * missing its employer or dates is one a recruiter's filter cannot match.
 */
export function parseQuality(parsed: AtsParsedResume) {
  const complete = parsed.roles.filter((role) => role.title && role.employer && role.start).length;
  const dated = parsed.roles.filter((role) => role.start).length;
  const contactFields = [parsed.name, parsed.email, parsed.phone].filter(Boolean).length;

  return {
    rolesDetected: parsed.roles.length,
    roleCompleteness: parsed.roles.length ? complete / parsed.roles.length : 0,
    datedRoleRatio: parsed.roles.length ? dated / parsed.roles.length : 0,
    contactCompleteness: contactFields / 3,
    educationDetected: parsed.education.length,
  };
}
