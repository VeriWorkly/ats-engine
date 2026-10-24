import { escapeRegex, normalizeText, wordListRegex } from "../text/text.js";
import { educationLevel } from "../parser/education.js";
import { isLeave, organisationWordsOf, titleWordsOf } from "../parser/experience.js";
import { isSectionHeading } from "../parser/sections.js";
import { findDateRange, findDates, isPlausibleDate } from "../parser/dates.js";
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
 * The months a document writes with their year, as "2019-9", in any form the parser reads ("Sep
 * 2019", "09/2019", a range's "09/19 –"): the line's dates and its range's ends.
 */
function writtenMonths(text: string, policy: AtsEnginePolicy, now: Date): Set<string> {
  const months = new Set<string>();
  const add = (date: AtsParsedDate | null | undefined) => {
    if (date?.month) months.add(`${date.year}-${date.month}`);
  };
  for (const line of text.split("\n")) {
    for (const { date } of findDates(line, policy.resumeParse, now)) add(date);
    const range = findDateRange(line, policy.resumeParse, now)?.range;
    add(range?.start);
    add(range?.end);
  }
  return months;
}

/**
 * Whether a document says a role is ongoing the way a date range does ("2020 – Present", "since
 * 2019", "Present" alone on the next line). The line must hold the role's start year or, without
 * one, sit beside its employer or title, so a "Now used by 2 million users" bullet does not
 * count. Read in the document's own language.
 */
export function ongoingIn(source: string, policy: AtsEnginePolicy) {
  const rp = inLanguagesOf(policy, source).resumeParse;
  const folded = (word: string) => normalizeText(word).toLowerCase();
  const everyday = new Set(rp.lineEndDateWords.map(folded));
  /** The words as one pattern; no word matches nothing. */
  const alternatives = (list: readonly string[]) =>
    list.length
      ? wordListRegex(list.map((word) => escapeRegex(normalizeText(word)))).source
      : "(?!)";
  /** The words of `list` that are (or are not) everyday words. */
  const pattern = (list: readonly string[], isEveryday: boolean) =>
    alternatives(list.filter((word) => everyday.has(folded(word)) === isEveryday));
  // A model reads resumes in languages no pack reads too: their words for a role still held count.
  const allOpenEnded = [
    ...rp.openEnded,
    ...policy.text.otherLanguages.flatMap((other) => other.openEnded),
  ];
  const openEnded = pattern(allOpenEnded, false);
  const everydayOpenEnded = pattern(rp.openEnded, true);
  const dash = `(?:[-–—]|${alternatives(rp.rangeWords)})`;
  // An open end after a dash or range word ("– present", "bis heute") or ending the line ("Jan
  // 2019 Present"), or a start ("since 2019"). An everyday word ("onwards", "ab", "से") counts
  // only as the parser reads it: after a date ("Jun 2021 onwards", not "दिल्ली से") or before one
  // ("ab 03/2020", not "Volvo AB 2018 – 2021"), ending the line.
  const range = new RegExp(
    [
      `${dash}\\s*(?:${openEnded})`,
      `(?:${openEnded})\\s*$`,
      pattern(rp.sinceWords, false),
      String.raw`\d\s*(?:${dash}\s*)?(?:${everydayOpenEnded})[\s.)\]]*$`,
      String.raw`(?:${pattern(rp.sinceWords, true)})\s+(?:\p{L}+\.?\s*)?\d[\d./-]*[\s.)\]]*$`,
    ].join("|"),
    "iu",
  );
  const anyOpenEnd = new RegExp(openEnded, "iu");
  const onlyEveryday = new RegExp(
    String.raw`^\s*(?:${dash}\s*)?(?:${everydayOpenEnded})\s*$`,
    "iu",
  );
  /** A line that is only the open end: "Present", "- to date", "- continuing". */
  const bare = (line: string | undefined) =>
    line !== undefined &&
    ((anyOpenEnd.test(line) && line.trim().split(/\s+/).length <= 3) || onlyEveryday.test(line));
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

/**
 * An email address and nothing else: a local part, then a domain of up to nine labels in any
 * script (`jane@bücher.de`, `张伟@example.cn`), which the parser's ASCII pattern leaves out.
 */
const WHOLE_EMAIL =
  /^[^\s@]{1,64}@(?:[\p{L}\p{M}\p{N}-]{1,63}\.){1,8}[\p{L}\p{M}][\p{L}\p{M}\p{N}-]{1,23}$/u;
/**
 * Only what a phone number is written with, once normalised (digits of every script as ASCII,
 * every dash as "-"): digits, "+", spaces, brackets ("(+44)"), dots, dashes, slashes; then an
 * extension ("ext. 12", ", x12", "extension 12", "#12") apart.
 */
const PHONE_SHAPE = /^([+\d\s().\-/]+?)(?:[\s,]*(?:ext(?:ension)?\.?|x|#)\s*\d{1,6})?$/i;
/**
 * A toll-free number (800, 833, 844 … 888) short of its digits, the one place capitals stand for
 * them: "1-800-FLOWERS", "1-800-GOT-JUNK". Not "(555) 010-2020 CELL", "2019-2021 AB", or a full
 * number's extension or note ("1-800-555-0199 EXT 12", "1-800-555-0199 CELL").
 */
const VANITY = /^(?:\+?1[\s.-]?)?\(?8([03-8])\1\)?[\s.-]?[\dA-Z]+(?:[\s.-][\dA-Z]+)*$/;
const isVanity = (text: string) =>
  VANITY.test(text) && (/^[^A-Z]*/.exec(text)![0].match(/\d/g)?.length ?? 0) < 10;
const MAX_PHONE_CHARS = 64;
/** A label before a phone number ("Mobile:", "Tel.:") and a note after it ("(US)", "(mobile)"). */
const PHONE_LABELS = /^\p{L}[\p{L}\s.]{0,20}:\s*|\s*\(\p{L}[\p{L}\s.]{0,20}\)$/gu;
/** Junk with a phone's characters: an IP address, years alone ("2019 2020 2021"). */
const NOT_A_PHONE = /^\d{1,3}(?:\.\d{1,3}){3}$|^\+?(?:(?:19|20)\d{2}[\s.\-/]*)+$/;
/** A generation after a name ("3rd"), the one place a name holds a digit. */
const ORDINAL = /\s\d{1,2}\p{L}{1,3}\.?$/u;

/**
 * Whether a value reads as a person's name: up to twelve words, a bracket after it ("(she/her)")
 * and a generation ("3rd") aside; capitalised words, lowercase only for a name particle or a
 * word of one or two letters ("da", "e"), or a name of two to four words all in lowercase. Not
 * two phrases joined by a comma ("Senior Engineer, Acme Corporation"; "Doe, Jane" and "Jane Doe,
 * PhD" are names), a heading, the document's title, a job title or an organisation (`roles`
 * names the document's roles' titles and employers).
 */
function isNameShaped(value: string, policy: AtsEnginePolicy, roles: readonly string[]) {
  if (value.length > 200) return false;
  const name = normalizeText(value)
    .trim()
    .replace(/\([^()]*\)$/u, "")
    .trimEnd()
    .replace(ORDINAL, "");
  if (!name || /[\d@/()]/u.test(name)) return false;
  const words = name.split(/\s+/);
  const phrases = name.split(",").filter((part) => part.trim().split(/\s+/).length > 1);
  if (words.length > 12 || phrases.length > 1) return false;
  const rp = policy.resumeParse;
  const particle = new RegExp(`^(?:${rp.nameParticles.join("|")})$`, "u");
  const lower = (word: string) => /^\p{Ll}/u.test(word);
  const cased = words.every((word) => !lower(word) || particle.test(word) || word.length <= 2);
  const lowercase =
    words.every(lower) && words.length >= 2 && words.length <= 4 && !/[.!?]$/u.test(name);
  if (!cased && !lowercase) return false;
  if (
    isSectionHeading(name, policy) ||
    new RegExp(`^(?:${rp.documentTitles.join("|")})$`, "iu").test(name)
  )
    return false;
  // A title or organisation word is a surname too ("Maria Head", "Anna Bank"). A part reads as a
  // title or an employer when one leads it or two are in it ("Head Chef", "Jane Doe, Engineer"),
  // or when the document's roles give it as a title or employer.
  const titled = (text: string) =>
    titleWordsOf(policy).test(text) || organisationWordsOf(policy).test(text);
  if (!titled(name)) return true;
  const folded = name.toLowerCase();
  if (roles.some((role) => normalizeText(role).trim().toLowerCase() === folded)) return false;
  return name.split(",").every((part) => {
    const partWords = part.trim().split(/\s+/);
    const count = partWords.filter(titled).length;
    // A phrase the policy lists whole ("Pty Ltd") counts as two.
    return !titled(part) || (count === 1 && !titled(partWords[0]!));
  });
}

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
  // a month with that year ("2019 - 2022" gives no month to keep), and "current" needs a
  // present-tense word beside the role's own dates.
  const text = normalizeText(source);
  const years = writtenYears(text);
  const months = writtenMonths(text, policy, now);
  const date = (value: AtsParsedDate | null) => {
    if (!isPlausibleDate(value, now) || !years.has(value.year)) return null;
    return value.month === null || months.has(`${value.year}-${value.month}`)
      ? value
      : { year: value.year, month: null };
  };
  const ongoing = ongoingIn(source, policy);
  const isCurrent = (role: AtsRepairCandidate["roles"][number], start: AtsParsedDate | null) =>
    role.current && ongoing(start?.year ?? null, [role.employer, role.title]);

  const core: ParsedCore = { ...deterministic };
  const filled = new Set<AtsParsedField>();

  // Grounded words are not enough: each contact field must also be the kind of value it holds.
  const roleNames = [...deterministic.roles, ...candidate.roles].flatMap((role) => [
    role.title,
    role.employer,
  ]);
  const shaped = {
    name: (value: string) => isNameShaped(value, policy, roleNames),
    email: (value: string) => WHOLE_EMAIL.test(value.trim()),
    // A phone's characters and 7 to 15 digits (E.164) besides an extension, ending in a group of
    // two or more ("978-3-16-148410-0" is an ISBN), and not a date range alone ("2017 - 2019";
    // "(11) 2019-2020" has more). libphonenumber's check would put its metadata in the `/ai` bundle.
    phone: (value: string) => {
      const text = normalizeText(value)
        .replace(/[\p{Pd}−]/gu, "-")
        .trim();
      const number = PHONE_SHAPE.exec(isVanity(text) ? text.replace(/[A-Z]/g, "2") : text)?.[1];
      if (number === undefined || NOT_A_PHONE.test(number.trim())) return false;
      if (!/^(?:\D*\d){7,15}\D*$/.test(number) || !/\d{2}\D*$/.test(number)) return false;
      const range = findDateRange(number, policy.resumeParse, now)?.matched;
      return !range || /\d/.test(number.replace(range, ""));
    },
  };
  // A phone is kept without its label and note: "+1 415 555 0134", not "Mobile: … (US)". Longer
  // is no phone number, and the lazy shape would rescan it.
  const phone = candidate.phone.length > MAX_PHONE_CHARS ? "" : candidate.phone;
  const values = { ...candidate, phone: phone.replace(PHONE_LABELS, "").trim() };
  for (const field of ["name", "email", "phone"] as const)
    if (!core[field] && ok(field, values[field]) && shaped[field](values[field])) {
      core[field] = values[field];
      filled.add(field);
    }

  if (core.roles.length === 0) {
    const roles = candidate.roles.flatMap((role, index) => {
      const title = ok(`roles[${index}].title`, role.title) ? role.title : "";
      const employer = ok(`roles[${index}].employer`, role.employer) ? role.employer : "";
      // Time off the parser dropped is no role either: "Parental leave", "Elternzeit".
      if ((!title && !employer) || isLeave(title, employer, policy)) return [];
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
