import type { AtsEnginePolicy } from "../policy/schema.js";
import type { AtsParsedCertification, AtsParsedLanguage, AtsParsedResume } from "../types.js";
import { parseCertificationList, parseCertifications } from "./certifications.js";
import { EMAIL, LINK, findName } from "./contact.js";
import { findDateRange } from "./dates.js";
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

/**
 * The category label on a skills line — "Languages: " in "Languages: TypeScript, Go". Needs a
 * space after the colon, so a value with a colon of its own ("https://…") is left whole.
 */
const SKILL_LABEL = /^[^:,;|]{1,40}:\s+/;

/** What separates one skill from the next: a list punctuation mark, or a column gap. */
const SKILL_SEPARATOR = /[,;|•·]|\s{2,}/g;

/**
 * A skills line cut into skills at its separators, except inside brackets: "AWS (EC2, S3,
 * Lambda)" is one skill. A separator inside a bracket that never closes still cuts, so a stray
 * "(" does not swallow the rest of the line.
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

/** Certifications in a list, each once by name, in the order first read. */
function addCertifications(into: AtsParsedCertification[], rows: AtsParsedCertification[]) {
  for (const row of rows)
    if (!into.some((kept) => kept.name.toLowerCase() === row.name.toLowerCase())) into.push(row);
}

/**
 * The certification and spoken-language rows, in page order: from their own sections, and from
 * a labelled line among the skills ("Languages: English (native)", "Certifications: PMP"). What
 * such a line names as rows is not also a skill, so the line comes back without it in `skillLines`
 * ("Languages: English, Python" leaves "Python"); "Languages: Go, Rust" names no language and
 * stays a skills line whole.
 */
export function readCredentialRows(
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
 * Recovers the fields an applicant tracking system stores, from the same plain text one would
 * receive.
 *
 * The point is not to parse perfectly. It is to parse *representatively*: an ATS shreds a resume
 * into name, contact, and one row per job holding an employer, a title and a date range, then
 * lets recruiters search and filter those rows. A resume whose job history cannot be recovered
 * does not rank badly — it arrives with empty columns, and no amount of keyword density fixes
 * that. So when this parser cannot find a field, that is itself the finding worth reporting, and
 * the recovered rows are worth showing the candidate verbatim: this is what the software sees.
 *
 * Everything here is deterministic and stays on the free tier. No model is involved.
 */
export function parseResume(
  lines: string[],
  policy: AtsEnginePolicy,
  now = new Date(),
): AtsParsedResume {
  return parseReadLines(readResumeLines(lines, policy).lines, policy, now);
}

/**
 * The resume's sections, with the name's line opening a block of its own when the name was read
 * over a headline further down. A sidebar read before the main column (a LinkedIn export: "Top
 * Skills" over its skills, then the name) leaves the name, the headline and the city under the
 * sidebar's last heading, where they were read as skills or certifications. Only such a name
 * cuts a section: one taken from a list's rows for want of another is one of its rows.
 */
export function readSections(lines: string[], policy: AtsEnginePolicy): ResumeSection[] {
  const sections = segmentResume(lines, policy);
  const { name, headlined } = findName(lines, policy);
  if (!headlined) return sections;
  const at = sections.findIndex((section) => section.lines.some((line) => line.trim() === name));
  const section = sections[at];
  if (!section?.headed) return sections;
  const cut = section.lines.findIndex((line) => line.trim() === name);
  return [
    ...sections.slice(0, at),
    { ...section, lines: section.lines.slice(0, cut) },
    { kind: "other", lines: section.lines.slice(cut), headed: false },
    ...sections.slice(at + 1),
  ];
}

/**
 * `parseResume` on lines already through `readResumeLines`, as `check` has them, and already
 * read into sections (`readSections`) when the caller has done that too.
 */
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
  // A resume with no recognisable Experience heading still has a work history somewhere, so the
  // fallback reads every block except the ones known not to hold jobs: a degree's "2010 - 2014"
  // read as a role once added four years of experience nobody worked, and a licence's dates
  // would too.
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
  // Without an Education heading, every block that can hold a degree is read, never a bullet:
  // "Ran a PhD intern program" is not a doctorate, nor "Partnered with Stanford University" a
  // school. From the work history, skills and projects — where the lines under an education
  // heading the policy does not know end up — only a line naming a degree, and the school line
  // beside it: not a role's dated header ("MBA Intern, Goldman Sachs  2019"), and not the employer
  // over a title ("Stanford University" / "Research Assistant").
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
    // A skill names something, so it has a letter: a date or a number under the Skills heading
    // ("Geburtsdatum: 04.05.1990", once its label is dropped) is not one.
    .filter(
      (skill) =>
        // One letter is a skill only as a capital — the languages R and C — not a stray "o".
        (skill.length > 1 || /^\p{Lu}$/u.test(skill)) &&
        skill.length <= 60 &&
        /\p{L}/u.test(skill) &&
        // Nor is an address: a links list under the skills is links.
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
 * How much of what an ATS needs was actually recoverable.
 *
 * `roleCompleteness` is the one that matters most: a job row missing its employer or its dates
 * is a row a recruiter's filter cannot match on, however well the bullets underneath it read.
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
