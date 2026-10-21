import { escapeRegex, normalizeText, wordListRegex } from "../text/text.js";
import { EMAIL } from "../parser/contact.js";
import { educationLevel } from "../parser/education.js";
import { findPhone } from "../parser/phone.js";
import { isPlausibleDate } from "../parser/dates.js";
import { parseQuality } from "../parser/index.js";
import { finalizeParsed, type ParsedCore } from "../parser/record.js";
import { inLanguagesOf } from "../locales/languages.js";
import type { AtsEnginePolicy } from "../policy/schema.js";
import type { AtsParsedDate, AtsParsedField, AtsParsedResume, AtsReport } from "../types.js";
import { findGroundingViolations, type GroundingViolation } from "./grounding.js";

// AI repair of a bad parse, minus the model call (the host's): when to offer it and what to accept.
// A model only fills fields the parser left empty, and everything it returns is grounded in the
// source first.

/** What a repair model returns: the recoverable fields, each possibly empty. */
export type AtsRepairCandidate = {
  name: string;
  email: string;
  phone: string;
  roles: Array<{
    title: string;
    employer: string;
    start: AtsParsedDate | null;
    end: AtsParsedDate | null;
    current: boolean;
  }>;
  education: Array<{ school: string; credential: string; end: AtsParsedDate | null }>;
  skills: string[];
};

/**
 * Whether the parse came back thin enough that a model re-read would likely help: the parser
 * visibly failed, not the score is low (a well-parsed resume can score badly on its merits).
 */
export function needsRepair(report: Pick<AtsReport, "parsed" | "wordCount">): boolean {
  // A structured document was read from its fields; a model could only find what they said.
  if (Object.values(report.parsed.provenance).includes("structured")) return false;
  const quality = parseQuality(report.parsed);

  // No roles from a document with real content: an unknown heading or an interleaved column layout.
  if (quality.rolesDetected === 0 && report.wordCount > 160) return true;
  // Rows missing employer or dates are not repairable: the merge never edits a row the parser found.
  // A stacked header commonly costs every contact field at once.
  return quality.contactCompleteness < 1 / 3;
}

/** What `mergeGrounded` needs besides the two records and the source. */
export type MergeOptions = {
  /** Classifies repaired credentials into degree levels. */
  policy: AtsEnginePolicy;
  /** Reference date for tenure and date plausibility. Defaults to the current time. */
  now?: Date | undefined;
};

/** The merged record, and the model's values that were dropped for not occurring in the source. */
export type MergeResult = {
  merged: AtsParsedResume;
  /** Values the model returned that do not occur in the source, with where each was found. */
  violations: GroundingViolation[];
};

/**
 * Two digits written as a year: after an apostrophe ("Jan '19"), after a month ("3/19", "03.19",
 * "03-19"; a single-digit month only with a slash, so "Python 3.11" is not a date), or ending a
 * range that starts with a full year ("2019–21").
 */
const TWO_DIGIT_YEAR =
  /(?:['‘’]|(?<![\d.,/-])(?:0?[1-9]|1[0-2])\/|(?<![\d.,/-])(?:0[1-9]|1[0-2])[.-]|(?<!\d)(?:19|20)\d{2} ?[-–—] ?)(\d{2})(?!\d|[.,]\d)/g;

/**
 * The years a document writes, in four digits or two (`TWO_DIGIT_YEAR`). A two-digit year stands
 * for both centuries; the plausibility check rules out the wrong one.
 */
export function writtenYears(text: string): Set<number> {
  const years = new Set<number>();
  for (const [year] of text.matchAll(/(?<!\d)(?:19|20)\d{2}(?!\d)/g)) years.add(Number(year));
  for (const [, short] of text.matchAll(TWO_DIGIT_YEAR))
    years.add(1900 + Number(short)).add(2000 + Number(short));
  return years;
}

/**
 * Whether a document says a role is ongoing the way a date range does ("2020 – Present", "since
 * 2019", "Present" alone on the next line). The line must hold the role's start year or, without
 * one, sit beside its employer or title, so a "Now used by 2 million users" bullet does not
 * count. Read in the document's own language.
 */
export function ongoingIn(source: string, policy: AtsEnginePolicy) {
  const localized = inLanguagesOf(policy, source);
  const words = (list: readonly string[]) => list.map((word) => escapeRegex(normalizeText(word)));
  const openEnded = wordListRegex(words(localized.resumeParse.openEnded));
  // An open end after a dash or range word ("– present", "bis heute"), or a start ("since 2019").
  const rangeWords = wordListRegex(words(localized.resumeParse.rangeWords)).source;
  const sinceWords = wordListRegex(words(localized.resumeParse.sinceWords)).source;
  // An open-ended word ending the line counts too ("Jan 2019 Present").
  const range = new RegExp(
    `(?:[-–—]|${rangeWords})\\s*(?:${openEnded.source})|(?:${openEnded.source})\\s*$|${sinceWords}`,
    "iu",
  );
  /** A line that is only the open end: "Present", "- to date". */
  const bare = (line: string | undefined) =>
    line !== undefined && openEnded.test(line) && line.trim().split(/\s+/).length <= 3;
  const lines = normalizeText(source).toLowerCase().split("\n");
  const near = (holds: (line: string) => boolean, datesBeside: boolean) =>
    lines.some(
      (line, index) =>
        holds(line) &&
        (range.test(line) ||
          bare(lines[index + 1]) ||
          // An employer or title with its dates on the line above or below.
          (datesBeside &&
            [lines[index - 1], lines[index + 1]].some(
              (next) => next !== undefined && range.test(next),
            ))),
    );
  return (startYear: number | null, anchors: readonly string[]) => {
    if (startYear !== null) {
      // The start year as written: "2019", "'19", "03/19".
      const short = String(startYear).slice(2);
      const year = new RegExp(
        `(?<!\\d)${startYear}(?!\\d)|['‘’]${short}(?!\\d)|\\/${short}(?!\\d)`,
      );
      return near((line) => year.test(line), false);
    }
    // The employer if any: a title such as "Engineer" can head another role too.
    const anchor = anchors.find((value) => value.trim());
    if (!anchor) return false;
    const text = normalizeText(anchor).toLowerCase();
    return near((line) => line.includes(text), true);
  };
}

/** An email address and nothing else, as the parser reads one. */
const WHOLE_EMAIL = new RegExp(`^(?:${EMAIL.source})$`, EMAIL.flags);

/**
 * Fills gaps in the deterministic parse with grounded AI values. A value the parser found is
 * never overwritten; a string that does not occur in the source is dropped; a role or school
 * survives only if its identifying field is grounded; an implausible date is dropped. Derived
 * fields (tenure, highest degree, provenance) are recomputed, and filled fields are stamped `ai`.
 */
export function mergeGrounded(
  deterministic: AtsParsedResume,
  candidate: AtsRepairCandidate,
  source: string,
  { policy: basePolicy, now = new Date() }: MergeOptions,
): MergeResult {
  // Read in the resume's own language (a no-op without packs).
  const policy = inLanguagesOf(basePolicy, source);
  const violations = findGroundingViolations(candidate, source);
  const rejected = new Set(violations.map((violation) => violation.path));
  // A value must assert something: "--" or "()" would otherwise fill a contact field.
  const ok = (path: string, value: string) => /[\p{L}\p{N}]/u.test(value) && !rejected.has(path);

  // Dates and "current" set tenure, so they are grounded too: a year must appear in the document,
  // and "current" needs a present-tense word beside the role's own dates.
  const years = writtenYears(normalizeText(source));
  const date = (value: AtsParsedDate | null) =>
    isPlausibleDate(value, now) && years.has(value.year) ? value : null;
  const ongoing = ongoingIn(source, policy);
  const isCurrent = (role: AtsRepairCandidate["roles"][number], start: AtsParsedDate | null) =>
    role.current && ongoing(start?.year ?? null, [role.employer, role.title]);

  const core: ParsedCore = { ...deterministic };
  const filled = new Set<AtsParsedField>();

  // Grounded words are not enough: each contact field must also be the kind of value it holds.
  const shaped = {
    name: (value: string) => !/[\d@/]/.test(value) && value.trim().split(/\s+/).length <= 6,
    email: (value: string) => WHOLE_EMAIL.test(value.trim()),
    phone: (value: string) => findPhone(value, policy, now) === value.trim(),
  };
  for (const field of ["name", "email", "phone"] as const)
    if (!core[field] && ok(field, candidate[field]) && shaped[field](candidate[field])) {
      core[field] = candidate[field];
      filled.add(field);
    }

  if (core.roles.length === 0) {
    const roles = candidate.roles.flatMap((role, index) => {
      const title = ok(`roles[${index}].title`, role.title) ? role.title : "";
      const employer = ok(`roles[${index}].employer`, role.employer) ? role.employer : "";
      if (!title && !employer) return [];
      const start = date(role.start);
      const current = isCurrent(role, start);
      return [{ title, employer, start, end: current ? null : date(role.end), current }];
    });
    if (roles.length) {
      core.roles = roles;
      filled.add("roles");
    }
  }

  if (core.education.length === 0) {
    const education = candidate.education.flatMap((entry, index) => {
      if (!ok(`education[${index}].school`, entry.school)) return [];
      const credential = ok(`education[${index}].credential`, entry.credential)
        ? entry.credential
        : "";
      return [
        {
          school: entry.school,
          credential,
          ...educationLevel(credential, policy),
          end: date(entry.end),
        },
      ];
    });
    if (education.length) {
      core.education = education;
      filled.add("education");
    }
  }

  if (core.skills.length === 0) {
    const skills = candidate.skills.filter((skill, index) => ok(`skills[${index}]`, skill));
    if (skills.length) {
      core.skills = skills;
      filled.add("skills");
    }
  }

  return {
    merged: finalizeParsed(
      core,
      (field) => (filled.has(field) ? "ai" : deterministic.provenance[field]),
      now,
    ),
    violations,
  };
}
