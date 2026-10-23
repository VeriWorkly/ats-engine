import type { AtsEnginePolicy } from "../policy/schema.js";
import type { AtsParsedDate } from "../types.js";
import { escapeRegex, normalizeText, wordListPattern } from "../text/text.js";
import { memo } from "../util/memo.js";
import { monthIndex, nowMonth } from "../util/months.js";

// Date patterns are built from the policy's vocabulary (month names, "present") and compiled once per policy.

type DateRange = {
  start: AtsParsedDate | null;
  end: AtsParsedDate | null;
  current: boolean;
};

type DateMatchers = {
  months: Record<string, number>;
  seasons: Record<string, readonly [number, number]>;
  range: RegExp;
  /** Any one date, globally: what `findDates` lists. */
  single: RegExp;
  named: RegExp;
  season: RegExp;
  openEnded: RegExp;
  /** A field that is an open end as a whole: "Current role", "- Present."; not "Present 2021". */
  openEndedField: RegExp;
  /** A field that is only a word between two dates: "से" alone is no open end. */
  rangeWordOnly: RegExp;
  /** An everyday word that dates a role only where its date ends the line: "onwards". */
  lineEnd: RegExp;
};

/** A two-digit year after an apostrophe: "Jan '20". */
const SHORT_YEAR = String.raw`['’‘]\d{2}(?!\d)`;

/** A bare year needs four digits: "19 - 22" is ambiguous with a numbered list. */
const YEAR_ONLY = /^\d{4}$/;

/** A letter of any script with its combining marks: the guard either side of a month name. */
const LETTER = String.raw`[\p{L}\p{M}]`;

/** The day of a written-out date, before the month name ("15. ") or after ("1, "). */
const DAY_BEFORE = String.raw`\d{1,2}\.?\s+`;
const DAY_AFTER = String.raw`(?:\d{1,2},?\s+)?`;

const buildMatchers = memo((rp: AtsEnginePolicy["resumeParse"]): DateMatchers => {
  // Keys are folded like resume text (`normalizeText`, lower case), which `parseDate` compares against.
  const months = Object.fromEntries(
    Object.entries(rp.months).map(([name, month]) => [normalizeText(name).toLowerCase(), month]),
  );
  const monthNames = Object.keys(months).map(escapeRegex).join("|");
  // Not followed by a letter: "Nowhere Labs" must not read as "now".
  const openEnded = `(?:${rp.openEnded
    .map((word) => escapeRegex(normalizeText(word)).replace(/\\?\s+/g, String.raw`\s*`))
    .join("|")})(?!${LETTER})`;
  const separator = String.raw`\s*(?:[‐‑‒–—―−~-]|${wordListPattern(rp.rangeWords)})\s*`;

  const seasons = Object.fromEntries(
    Object.entries(rp.seasons).map(([name, span]) => [normalizeText(name).toLowerCase(), span]),
  );
  const seasonNames = Object.keys(seasons).map(escapeRegex).join("|") || "(?!)";
  const seasonDate = String.raw`(?<!${LETTER})(?:${seasonNames})[\s-]+\d{4}(?!\d)`;
  /**
   * A single point in time. Years are fenced with `(?<!\d)` / `(?!\d)` ("10000-20000" is no
   * range). A month name is a whole word the policy lists, with an optional full stop, then
   * `[\s-]*` ("Jan-2020", "Jan2020") and a four-digit year or an apostrophe two-digit one
   * (resolved by `findDateRange`); a listed season counts too. A day may stand either side of the
   * name and is skipped. Numeric forms, longest first: a full date, month and year either way
   * round (not starting inside a full date), then a bare year.
   */
  const date = String.raw`(?:(?:(?<!\d)${DAY_BEFORE})?(?<!${LETTER})(?:${monthNames})\.?[\s-]*(?:${DAY_AFTER}\d{4}(?!\d)|${SHORT_YEAR})|${seasonDate}|(?<!\d)\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4}(?!\d)|(?<!\d)\d{4}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2}(?!\d)|(?<![\d./-])\d{1,2}\s*[./-]\s*\d{4}(?!\d)|(?<!\d)\d{4}\s*[./-]\s*\d{1,2}(?![\d./-])|(?<!\d)\d{4}(?!\d))`;
  // "since 2019": a start with no end is a current role.
  const since = wordListPattern(rp.sinceWords);

  // A range's end may be a year's last two digits ("2019–21"); `findDateRange` places them.
  const shortEnd = String.raw`\d{2}(?![\d./-])`;
  // A month, with its zero, and a two-digit year ("06/21"), read only as a range's ends: alone,
  // "10/10" is a rating, and "7/10 - 9/10" a score.
  const monthYear = String.raw`(?<![\d./-])(?:0[1-9]|1[0-2])\s*\/\s*\d{2}(?![\d./])`;

  return {
    months,
    seasons,
    // Global so `findDateRange` can try the next candidate on a line. The second branch reads
    // "Jan 2020 to date" (the "to" belongs to the open-ended phrase); then a season alone; the
    // last a range of months and two-digit years ("06/21 - Present").
    range: new RegExp(
      String.raw`(${date})(?:${separator}(${date}|${openEnded}|${shortEnd})|\s+(${openEnded}))|${since}\s+(${date})|(${seasonDate})|(${monthYear})${separator}(${monthYear}|${openEnded})`,
      "giu",
    ),
    single: new RegExp(date, "giu"),
    named: new RegExp(
      String.raw`^(?:${DAY_BEFORE})?(${monthNames})\.?[\s-]*${DAY_AFTER}(\d{4}|${SHORT_YEAR})$`,
      "u",
    ),
    season: new RegExp(String.raw`^(${seasonNames})[\s-]+(\d{4})$`, "u"),
    openEnded: new RegExp(`^${openEnded}$`, "iu"),
    openEndedField: new RegExp(
      String.raw`^[\s(\[]*(?:[‐‑‒–—―−~-]\s*)?${openEnded}[\s.)\]]*$`,
      "iu",
    ),
    rangeWordOnly: new RegExp(String.raw`^\s*${wordListPattern(rp.rangeWords)}\s*$`, "iu"),
    lineEnd: new RegExp(String.raw`^\s*${wordListPattern(rp.lineEndDateWords)}\s*$`, "iu"),
  };
});

/**
 * Whether a structured document's end field, holding no date, says the role or study is still
 * going on: the whole field is an open end the policy and its packs read ("heute", "Current
 * role", "Till now"), not one with more after it ("Present 2021", "Heute nicht") nor a word that
 * only joins two dates (Hindi "से").
 */
export function saysOngoing(end: string | undefined, rp: AtsEnginePolicy["resumeParse"]) {
  if (!end?.trim()) return false;
  const value = normalizeText(end);
  const { openEndedField, rangeWordOnly } = buildMatchers(rp);
  return openEndedField.test(value) && !rangeWordOnly.test(value);
}

/**
 * One date as written. A two-digit year comes back as those digits for `findDateRange` to place.
 * A season is its first month at the start of a range and its last at the end.
 */
function parseDate(
  raw: string,
  rp: AtsEnginePolicy["resumeParse"],
  edge: "start" | "end" = "start",
): AtsParsedDate | null {
  const { months, named, seasons, season } = buildMatchers(rp);
  const value = raw.trim().toLowerCase();

  const namedMatch = value.match(named);
  if (namedMatch)
    return { year: Number(namedMatch[2].replace(/^\D/u, "")), month: months[namedMatch[1]] };

  const seasonMatch = value.match(season);
  if (seasonMatch) {
    const [first, last] = seasons[seasonMatch[1]];
    return { year: Number(seasonMatch[2]), month: edge === "start" ? first : last };
  }
  if (/^\d{2}$/.test(value)) return { year: Number(value), month: null };

  const month = (value: number) => (value >= 1 && value <= 12 ? value : null);

  // A full date: only the month is kept; which number it is depends on `dateOrder` unless one is over 12.
  const full = value.match(/^(\d{1,4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,4})$/);
  if (full) {
    const [first, second, third] = full.slice(1).map(Number);
    if (full[1].length === 4) return month(second) ? { year: first, month: second } : null;
    if (full[3].length !== 4) return null;
    const dayFirst = first > 12 ? true : second > 12 ? false : rp.dateOrder === "DMY";
    const m = month(dayFirst ? second : first);
    return m ? { year: third, month: m } : null;
  }

  // "06/21": the year's two digits, for `findDateRange` to place.
  const monthYear = value.match(/^(\d{1,2})\s*\/\s*(\d{2})$/);
  if (monthYear && month(Number(monthYear[1])))
    return { year: Number(monthYear[2]), month: Number(monthYear[1]) };

  const numeric = value.match(/^(\d{1,2})\s*[./-]\s*(\d{4})$/);
  if (numeric && month(Number(numeric[1])))
    return { year: Number(numeric[2]), month: Number(numeric[1]) };

  // "2021-03" and "2021/03".
  const iso = value.match(/^(\d{4})\s*[./-]\s*(\d{1,2})$/);
  if (iso && month(Number(iso[2]))) return { year: Number(iso[1]), month: Number(iso[2]) };

  if (YEAR_ONLY.test(value)) return { year: Number(value), month: null };
  return null;
}

// The years a date can plausibly name: "from 1000 to 5000 users" is not a job.
const EARLIEST_YEAR = 1950;
const YEARS_AHEAD = 10;

export function isPlausibleDate(date: AtsParsedDate | null, now: Date): date is AtsParsedDate {
  return (
    date !== null &&
    date.year >= EARLIEST_YEAR &&
    date.year <= now.getUTCFullYear() + YEARS_AHEAD &&
    (date.month === null || (date.month >= 1 && date.month <= 12))
  );
}

const ISO_DATE = /^(\d{4})(?:-(\d{1,2}))?(?:-\d{1,2})?(?:T.*)?$/;

/**
 * A date from a structured document field: `YYYY-MM-DD`, `YYYY-MM` or `YYYY`, else any spelling
 * the policy reads. Held to the same plausibility bounds as a parsed date.
 */
export function parseDocumentDate(
  raw: string | undefined,
  rp: AtsEnginePolicy["resumeParse"],
  now: Date,
): AtsParsedDate | null {
  const value = raw?.trim();
  if (!value) return null;
  const iso = ISO_DATE.exec(value);
  const date = iso
    ? { year: Number(iso[1]), month: iso[2] ? Number(iso[2]) : null }
    : parseDate(value, rp);
  return isPlausibleDate(date, now) ? date : null;
}

/** A date written with a two-digit year: "21", "Jan '20", "06/21". "0000" is a four-digit one. */
const TWO_DIGIT_YEAR = /(?:^|['’‘/])\d{2}$/u;

/** A two-digit year in the latest century that keeps it at or before `latest`. */
function withCentury(date: AtsParsedDate | null, latest: number): AtsParsedDate | null {
  if (!date || date.year >= 100) return date;
  const year = Math.floor(latest / 100) * 100 + date.year;
  return { ...date, year: year > latest ? year - 100 : year };
}

/** A two-digit end year as the first year ending in those digits on or after the start's. */

function afterStart(date: AtsParsedDate | null, startYear: number): AtsParsedDate | null {
  if (!date || date.year >= 100) return date;
  const year = Math.floor(startYear / 100) * 100 + date.year;
  return { ...date, year: year < startYear ? year + 100 : year };
}

/** A date read as a range start would be: a two-digit year goes in the century keeping it within `YEARS_AHEAD`. */
function placedStart(raw: string, rp: AtsEnginePolicy["resumeParse"], now: Date) {
  const parsed = parseDate(raw, rp);
  return TWO_DIGIT_YEAR.test(raw.trim())
    ? withCentury(parsed, now.getUTCFullYear() + YEARS_AHEAD)
    : parsed;
}

/**
 * The first date range on the line that reads as a real span of time. A candidate is skipped when
 * either end is unreadable, a year is outside [1950, now + 10], or the range runs backwards; later
 * candidates on the line are still tried ("Engineer 2010 · 2019 - 2022").
 *
 * Two-digit years are placed here: a start's in the century that keeps it at most ten years ahead
 * of `now`, an end's in the first year on or after the start ending in those digits ("2019–21").
 * A bare two-digit end follows only a bare year, not an unspaced hyphen when it could be a month
 * ("2021-03"), not one landing more than `aheadYears` after `now` (an expected graduation), and
 * not one followed by a word ("Suite 2021 - 30 Main St").
 *
 * A season alone ("Summer 2018") counts only when the line holds no range and it stands apart
 * (not in "Led the Fall 2021 recruiting season").
 *
 * Cached per line within one reading of a resume (`readingDatesAt`): many readers ask of the same
 * lines, and 25,000 short lines would cost 25,000 searches each time.
 */
export function findDateRange(
  line: string,
  rp: AtsEnginePolicy["resumeParse"],
  now: Date = new Date(),
  { aheadYears = 0 }: { aheadYears?: number } = {},
): DateRangeFound | null {
  const read = readings.get(now)?.(rp);
  if (!read) return searchDateRange(line, rp, now, aheadYears);
  const key = `${aheadYears} ${line}`;
  if (read.has(key)) return read.get(key)!;
  const found = searchDateRange(line, rp, now, aheadYears);
  read.set(key, found);
  return found;
}

type DateRangeFound = { range: DateRange; matched: string };

/**
 * The lines read for dates in each reading of a resume, by the reading's own `now`, then by the
 * policy. A caller's own `now` is never a key: its lines are searched every time.
 */
const readings = new WeakMap<
  Date,
  (rp: AtsEnginePolicy["resumeParse"]) => Map<string, DateRangeFound | null>
>();

/**
 * A `now` for one reading of a resume, with the same time: `findDateRange` reads each line once
 * while passed this Date. Made fresh by each `check` and `parseResume`, so the cache lasts one
 * reading.
 */
export function readingDatesAt(now: Date): Date {
  const reading = new Date(now.getTime());
  readings.set(
    reading,
    memo(() => new Map()),
  );
  return reading;
}

/**
 * What may follow a date that ends its line or column: nothing but a full stop or a closing
 * bracket, else a tab, a gap of two spaces or a bar.
 */
const ENDS_LINE_OR_COLUMN = /^(?:[\s.)\]]*$|[^\S\t]*\t|\s{2}|\s*[|·•])/u;

/** Every date holds two digits in a row; a line without them is not searched (the lookbehinds are costly). */
const TWO_DIGITS = /\d\d/;

function searchDateRange(
  line: string,
  rp: AtsEnginePolicy["resumeParse"],
  now: Date,
  aheadYears: number,
): DateRangeFound | null {
  if (!TWO_DIGITS.test(line)) return null;
  const matchers = buildMatchers(rp);
  let term: { range: DateRange; matched: string } | null = null;

  // A copy, so a "since" read wrongly is searched again from its date ("Volvo AB 2018 – 2021").
  const range = new RegExp(matchers.range);
  for (let match = range.exec(line); match; match = range.exec(line)) {
    // Group 4 is the "since 2019" branch (a role still held); group 5 a season alone, kept for
    // when the line holds no range.
    if (match[5] !== undefined) {
      if (term || !standsApart(line, match.index, match[0].length)) continue;
      const start = parseDate(match[5], rp, "start");
      const end = parseDate(match[5], rp, "end");
      if (!isPlausibleDate(start, now) || !isPlausibleDate(end, now)) continue;
      term = { range: { start, end, current: false }, matched: match[0] };
      continue;
    }
    // Groups 6 and 7: a range of months and two-digit years.
    const endText = match[2] ?? match[3] ?? match[7];
    const current = match[4] !== undefined || matchers.openEnded.test(endText.trim());
    const after = line.slice(match.index + match[0].length);
    // An everyday open end ends its line or column: "Jun 2021 onwards", not "2020 onwards, growth
    // of 30%" or "2017 से टीम का नेतृत्व किया". Any other may have a place after it ("Present remote").
    if (endText !== undefined && matchers.lineEnd.test(endText) && !ENDS_LINE_OR_COLUMN.test(after))
      continue;
    // A span of two months with two-digit years ends its line or column too: "01/15 - 05/21", not
    // "Rated 08/10 - 10/10 by users" or "Ran hackathon 09/15 - 09/17 at MIT".
    if (match[6] !== undefined && !current && !ENDS_LINE_OR_COLUMN.test(after)) continue;
    // So does an everyday since word's date ("ab 03/2020", not "Umsatz ab 2017 um 30 %"), the word
    // not in capitals ("Volvo AB").
    if (match[4] !== undefined) {
      const word = match[0].slice(0, -match[4].length);
      if (
        matchers.lineEnd.test(word) &&
        (/\p{Lu}{2}/u.test(word) || !ENDS_LINE_OR_COLUMN.test(after))
      ) {
        range.lastIndex = match.index + word.length;
        continue;
      }
    }
    const startText = match[1] ?? match[4] ?? match[6];
    const start = placedStart(startText, rp, now);
    const shortEnd = !current && /^\d{2}$/.test(endText.trim());
    if (shortEnd) {
      if (!YEAR_ONLY.test(startText.trim())) continue;
      if (/^\d{4}-\d{2}$/.test(match[0].trim()) && Number(endText) <= 12) continue;
      if (WORD_AFTER.test(after)) continue;
    }
    const parsedEnd = current ? null : parseDate(endText, rp, "end");
    const end =
      start && parsedEnd && TWO_DIGIT_YEAR.test(endText.trim())
        ? afterStart(parsedEnd, start.year)
        : parsedEnd;

    if (!isPlausibleDate(start, now)) continue;
    // A "since" date still to come dates no role ("Verfügbar ab 01/2027"): searched again from it.
    if (match[4] !== undefined && monthIndex(start) > nowMonth(now)) {
      range.lastIndex = match.index + match[0].length - match[4].length;
      continue;
    }
    if (!current && (!isPlausibleDate(end, now) || monthIndex(end, 12) < monthIndex(start)))
      continue;
    if (shortEnd && end && end.year > now.getUTCFullYear() + aheadYears) continue;

    return { range: { start, end, current }, matched: match[0] };
  }
  return term;
}

/**
 * Every plausible date on the line, with where each stands ("Issued Mar 2022 · Expires Mar 2025"
 * holds two dates and no range). A two-digit year is placed as a range's start would be.
 */
export function findDates(
  line: string,
  rp: AtsEnginePolicy["resumeParse"],
  now: Date,
): Array<{ date: AtsParsedDate; index: number; end: number }> {
  const found: Array<{ date: AtsParsedDate; index: number; end: number }> = [];
  if (!TWO_DIGITS.test(line)) return found;
  for (const match of line.matchAll(buildMatchers(rp).single)) {
    const raw = match[0];
    const date = placedStart(raw, rp, now);
    if (isPlausibleDate(date, now))
      found.push({ date, index: match.index, end: match.index + raw.length });
  }
  return found;
}

/** A word straight after a date, one space away at most: "30 Main St", not a column. */
const WORD_AFTER = /^ ?[\p{L}]/u;

/** Whether the text at `index` stands apart: at the line's start or end (give or take brackets), or set off by a gap, tab or bar. */
function standsApart(line: string, index: number, length: number) {
  const before = line.slice(0, index);
  const after = line.slice(index + length);
  if (/^[\s([|•·–—-]*$/u.test(before) || /^[\s)\].,;:|•·–—-]*$/u.test(after)) return true;
  const head = before.trimEnd();
  const tail = after.trimStart();
  return (
    before.endsWith("\t") ||
    before.length - head.length >= 2 ||
    /[|·•]$/u.test(head) ||
    after.startsWith("\t") ||
    after.length - tail.length >= 2 ||
    /^[|·•]/u.test(tail)
  );
}
