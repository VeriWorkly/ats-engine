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
  /** `universityWords`, where a program named by its field alone is the first degree. */
  universities: RegExp | null;
  /** `courseWords`: a course or a term abroad, never a degree. */
  courses: RegExp;
  /** A city or a country, whole. */
  places: RegExp;
};

/** The first part of an education line, before its first separator: the field, when it leads. */
const LEADING_PART = /^[^,|·•\t–—]+/u;

/**
 * ISCED 6 for "Administración de Empresas, Universidad de Antioquia, 2015": a field alone before a
 * university the policy names (`universityWords`), where postgraduate programs always name
 * themselves. Null when the school leads or a degree is written, and when what leads is no field:
 * a date ("Marzo 2010 – 2015"), a place ("Medellín"), or a course or a term abroad
 * (`courseWords`: "Curso de Inglés", "Semestre de intercambio").
 */
function fieldAtUniversity(line: string, school: string, policy: AtsEnginePolicy) {
  const { universities, courses, places } = matchersFor(policy.resumeParse);
  if (!universities || !school || !universities.test(school)) return null;
  const field = LEADING_PART.exec(line)?.[0].trim() ?? "";
  const isField =
    /\p{L}{3}/u.test(field) &&
    !/\d/u.test(field) &&
    !school.includes(field) &&
    !field.includes(school) &&
    !courses.test(field) &&
    !places.test(field);
  return isField ? (6 as AtsIscedLevel) : null;
}

const matchersFor = memo((rp: AtsEnginePolicy["resumeParse"]): EducationMatchers => ({
  schools: wordListRegex(rp.schoolWords),
  schoolsAll: wordListRegex(rp.schoolWords, "gi"),
  universities: rp.universityWords.length ? wordListRegex(rp.universityWords) : null,
  courses: wordListRegex(rp.courseWords.length ? rp.courseWords : ["(?!)"]),
  places: new RegExp(`^(?:${[...rp.cityNames, ...rp.placeNames].join("|") || "(?!)"})$`, "iu"),
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
  // The last entry, the line that last named it and the line it opened on.
  let last: { at: number; from: number; entry: AtsParsedEducation } | null = null;
  // A line holding only a date range or a year: what it ends, else undefined.
  const datesOn = (line: string | undefined) => {
    if (line === undefined) return undefined;
    const range = findDateRange(line, policy.resumeParse, now, { aheadYears: DEGREE_YEARS });
    if (range) return /\p{L}/u.test(line.replace(range.matched, "")) ? undefined : range.range.end;
    return /^[\s(]*\d{4}[\s).]*$/u.test(line) ? loneYear(line, now) : undefined;
  };

  lines.forEach((line, at) => {
    const degree = degreeLevel(line, policy);
    const isSchool = schools.test(line);
    if (!degree && !isSchool) {
      // Dates on a line of their own under an entry end it ("BSc Computer Science" over
      // "University of Leeds" over "2015 – 2019"), unless such a line heads each entry instead.
      if (last?.at === at - 1 && !last.entry.end && datesOn(lines[last.from - 1]) === undefined)
        last.entry.end = datesOn(line) ?? null;
      return;
    }

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
      isced: degree?.isced ?? fieldAtUniversity(line, school, policy),
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
      last = { at, from: open!.at, entry: other };
      open = null;
      return;
    }

    entries.push(entry);
    last = { at, from: at, entry };
    open = entry.school && entry.isced ? null : { at, entry };
  });

  return entries;
}

const YEAR = /(?<!\d)(?:19|20)\d{2}(?!\d)/g;
/** How far ahead an expected graduation's short end year may run: "2023–27". */
const DEGREE_YEARS = 6;

/**
 * The separators an education line's parts are printed between. A dash's spaces match from the
 * start of their run (else a long run without a dash rescans from every position); a comma
 * between digits is decimal ("Note 1,7").
 */
const PART = /[|•·]|(?<!\d),|,(?!\d)|(?<!\s)\s+[–—-]\s+/;
/**
 * The same, and a tab stop or a column gap, as a DOCX or a PDF prints them; not one after a short
 * word that joins the name's words: in lower case ("University of  Oregon", "Universität für
 * Musik"), in title case up to three letters ("University Of  Oregon"), or in capitals after a word
 * in capitals ("UNIVERSITY OF  OREGON"). "Iowa", "BS" or "MBA" before a gap is a part of its own.
 */
const GAPPED = new RegExp(
  String.raw`${PART.source}|(?<!\s|(?:^|\s)(?:\p{Ll}{1,4}|\p{Lu}\p{Ll}{0,2}))(?<!\p{Lu}{2}\s\p{Lu}{1,4})(?:\s{2,}|\t)`,
  "u",
);

/** Brackets a date range or a year was taken out of: "University of Oregon ( )". */
const EMPTY_BRACKETS = /[([]\s*[)\]]/g;

/** A month and year standing alone: "06/2011", "6.2011". */
const MONTH_YEAR = /(?<![\d./-])\d{1,2}[./](?:19|20)\d{2}(?![\d./-])/g;

/** A bracketed note holding a number after a school's name: "(Note 1,7)", "(GPA 3.8)". */
const NUMBERED_NOTE = /\([^()\d]{0,40}\d[^()]{0,40}\)/g;

/**
 * The institution named in an education line, its date range already taken out: the part naming
 * the school, not the credential ("High School Diploma, Lincoln High School"); ending at its
 * comma (a campus, city or field of study cannot be told apart without vocabulary); a lone year
 * or month and year dropped. A tab stop or a column gap parts the line too, unless it only parts
 * the school's own words ("Lakeview  University").
 */
function schoolName(text: string, credential: string, policy: AtsEnginePolicy) {
  const { schools, schoolsAll } = matchersFor(policy.resumeParse);
  // Brackets a spaced range came out of ("( 2014 - 2018 )") would leave a gap inside them.
  const unbracketed = text.replace(EMPTY_BRACKETS, " ");
  for (const separator of [GAPPED, PART]) {
    const pieces = unbracketed.split(separator);
    const name = (at: number) =>
      pieces[at]
        .replace(NUMBERED_NOTE, " ")
        .replace(MONTH_YEAR, " ")
        .replace(YEAR, " ")
        .replace(EMPTY_BRACKETS, " ")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/(?<![\s,–—-])[\s,–—-]+$/, "");
    // A school word alone is a heading ("SCHOOL"), not the name of one, unless a comma parts it
    // from a credential: an institution named by its word ("Tecnólogo en Logística, SENA, 2013").
    // Parted by a column gap, it is the end of a name ("Lakeview  University").
    const named = (at: number) =>
      schools.test(name(at)) &&
      (name(at).replace(schoolsAll, "").trim() ||
        (separator === PART &&
          credential !== "" &&
          pieces.some((piece, i) => i !== at && piece.includes(credential))));

    let at = pieces.findIndex(
      (piece, i) => named(i) && !(credential && piece.includes(credential)),
    );
    if (at === -1) at = pieces.findIndex((_, i) => named(i));
    if (at !== -1) return name(at);
  }
  return "";
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
