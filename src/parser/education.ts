import type { AtsEnginePolicy } from "../policy/schema.js";
import { wordListRegex } from "../text/text.js";
import { policyRegex } from "../policy/regex.js";
import type { AtsIscedLevel, AtsParsedDate, AtsParsedEducation } from "../types.js";
import { findDateRange, isPlausibleDate } from "./dates.js";
import { memo } from "../util/memo.js";

type EducationMatchers = {
  schools: RegExp;
  /** The same, global: to take every school word out of a name. */
  schoolsAll: RegExp;
  /** Highest level first, so a line naming two credentials is recorded at the higher one. */
  levels: Array<{ isced: AtsIscedLevel; re: RegExp }>;
};

const matchersFor = memo((rp: AtsEnginePolicy["resumeParse"]): EducationMatchers => ({
  schools: wordListRegex(rp.schoolWords),
  schoolsAll: wordListRegex(rp.schoolWords, "gi"),
  levels: Object.entries(rp.degrees)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([level, pattern]) => ({
      isced: Number(level) as AtsIscedLevel,
      re: policyRegex(pattern, "i"),
    }))
    .sort((a, b) => b.isced - a.isced),
}));

type NamedLevel = { isced: AtsIscedLevel; matched: string };

/** Every education level a text names, highest first, with the words that named each. */
export function degreeLevels(text: string, policy: AtsEnginePolicy): NamedLevel[] {
  return matchersFor(policy.resumeParse).levels.flatMap(({ isced, re }) => {
    const match = re.exec(text);
    return match ? [{ isced, matched: match[0].trim() }] : [];
  });
}

/** The highest education level a text names. */
export function degreeLevel(text: string, policy: AtsEnginePolicy): NamedLevel | null {
  return degreeLevels(text, policy)[0] ?? null;
}

/** The level fields of an education row whose credential is already known to be one. */
export function educationLevel(credential: string, policy: AtsEnginePolicy) {
  const degree = credential ? degreeLevel(credential, policy) : null;
  return { isced: degree?.isced ?? null };
}

export function parseEducation(
  lines: string[],
  policy: AtsEnginePolicy,
  now: Date = new Date(),
): AtsParsedEducation[] {
  const { schools } = matchersFor(policy.resumeParse);
  const entries: AtsParsedEducation[] = [];

  // The line that named the last entry, while that entry still lacks a school or a credential.
  let open: { at: number; entry: AtsParsedEducation } | null = null;

  lines.forEach((line, at) => {
    const degree = degreeLevel(line, policy);
    const isSchool = schools.test(line);
    if (!degree && !isSchool) return;

    // An expected graduation may be ahead of today, up to a degree's length.
    const range = findDateRange(line, policy.resumeParse, now, { aheadYears: DEGREE_YEARS });

    // The date range comes out first, or it rides along on the school name.
    const school = isSchool
      ? schoolName(range ? line.replace(range.matched, " ") : line, degree?.matched ?? "", policy)
      : "";
    if (!degree && !school) return;
    const entry: AtsParsedEducation = {
      school,
      credential: degree?.matched ?? "",
      isced: degree?.isced ?? null,
      end: range ? range.range.end : loneYear(line, now),
    };

    // A degree over or under its school is one entry, unless the two lines are dated differently
    // ("B.Tech, IIT Bombay, 2014 - 2018" over "Class XII, Delhi Public School, 2014").
    const other = open?.at === at - 1 ? open.entry : null;
    const datedApart = other?.end && entry.end && other.end.year !== entry.end.year;
    if (
      other &&
      !datedApart &&
      (other.school ? !entry.school && entry.isced : entry.school && !entry.isced)
    ) {
      other.school ||= entry.school;
      other.credential ||= entry.credential;
      other.isced ??= entry.isced;
      other.end ??= entry.end;
      open = null;
      return;
    }

    entries.push(entry);
    open = entry.school && entry.isced ? null : { at, entry };
  });

  return entries;
}

const YEAR = /(?<!\d)(?:19|20)\d{2}(?!\d)/g;
/** How far ahead an expected graduation's short end year may run: "2023–27". */
const DEGREE_YEARS = 6;

/**
 * The separators an education line's parts are printed between, kept by `split`. A dash's spaces
 * match from the start of their run (else a long run without a dash rescans from every position);
 * a comma between digits is decimal ("Note 1,7").
 */
const PART = /([|•·]|(?<!\d),|,(?!\d)|(?<!\s)\s+[–—-]\s+)/;

/** A month and year standing alone: "06/2011", "6.2011". */
const MONTH_YEAR = /(?<![\d./-])\d{1,2}[./](?:19|20)\d{2}(?![\d./-])/g;

/** A bracketed note holding a number after a school's name: "(Note 1,7)", "(GPA 3.8)". */
const NUMBERED_NOTE = /\([^()\d]{0,40}\d[^()]{0,40}\)/g;

/**
 * The institution named in an education line, its date range already taken out: the part naming
 * the school, not the credential ("High School Diploma, Lincoln High School"); ending at its
 * comma (a campus, city or field of study cannot be told apart without vocabulary); a lone year
 * or month and year dropped.
 */
function schoolName(text: string, credential: string, policy: AtsEnginePolicy) {
  const { schools, schoolsAll } = matchersFor(policy.resumeParse);
  const pieces = text.split(PART);
  const name = (at: number) =>
    pieces[at]
      .replace(NUMBERED_NOTE, " ")
      .replace(MONTH_YEAR, " ")
      .replace(YEAR, " ")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/(?<![\s,–—-])[\s,–—-]+$/, "");
  // A school word alone is a heading ("SCHOOL"), not the name of one.
  const named = (at: number) =>
    at % 2 === 0 && schools.test(name(at)) && !onlySchoolWords(name(at));
  const onlySchoolWords = (text: string) => text.replace(schoolsAll, "").trim() === "";

  let at = pieces.findIndex((piece, i) => named(i) && !(credential && piece.includes(credential)));
  if (at === -1) at = pieces.findIndex((_, i) => named(i));
  return at === -1 ? "" : name(at);
}

/** "Stanford University, B.S., 2018": the last plausible year on the line, when no range is. */
function loneYear(line: string, now: Date): AtsParsedDate | null {
  const years = line.match(YEAR);
  const year = years ? Number(years[years.length - 1]) : NaN;
  const date = { year, month: null };
  return isPlausibleDate(date, now) ? date : null;
}

/** The highest level among the entries, by ISCED. */
export function highestIsced(entries: AtsParsedEducation[]) {
  let best: AtsIscedLevel | null = null;
  for (const { isced } of entries)
    if (isced !== null && (best === null || isced > best)) best = isced;
  return best;
}
