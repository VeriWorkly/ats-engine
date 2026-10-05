import type { AtsEnginePolicy } from "../policy/schema.js";
import type { AtsParsedDate } from "../types.js";
import { escapeRegex, normalizeText, wordListPattern } from "../text/text.js";
import { memo } from "../util/memo.js";

/**
 * Date recognition, built from the policy's vocabulary rather than from constants in source.
 *
 * Month names and the spellings of "still here" are language-bound, so they are data. The
 * patterns are compiled per policy and memoised against it, because building six regexes for
 * every line of every resume is measurable and the policy object is stable for the life of a
 * request.
 */

export type DateRange = {
  start: AtsParsedDate | null;
  end: AtsParsedDate | null;
  current: boolean;
};

type DateMatchers = {
  months: Record<string, number>;
  seasons: Record<string, readonly [number, number]>;
  range: RegExp;
  named: RegExp;
  season: RegExp;
  openEnded: RegExp;
};

/** A two-digit year after an apostrophe: "Jan '20". */
const SHORT_YEAR = String.raw`['’‘]\d{2}(?!\d)`;

/** A lone year range like "2019 - 2022" is ambiguous with a numeric bullet; require four digits. */
const YEAR_ONLY = /^\d{4}$/;

/** A letter of any script, with its combining marks: the guard either side of a month name. */
const LETTER = String.raw`[\p{L}\p{M}]`;

/** The day of a written-out date: "15 " or "15. " before the month name, "1, " or "1 " after. */
const DAY_BEFORE = String.raw`\d{1,2}\.?\s+`;
const DAY_AFTER = String.raw`(?:\d{1,2},?\s+)?`;

const buildMatchers = memo((rp: AtsEnginePolicy["resumeParse"]): DateMatchers => {
  // Keys are folded the way resume text is (`normalizeText`, then lower case), because
  // `parseDate` compares against that: a policy that spelled a month "Jan", or "फ़रवरी" with a
  // precomposed nukta, would otherwise find the range and then fail to read it.
  const months = Object.fromEntries(
    Object.entries(rp.months).map(([name, month]) => [normalizeText(name).toLowerCase(), month]),
  );
  const monthNames = Object.keys(months).map(escapeRegex).join("|");
  // Not followed by a letter: "Nowhere Labs" must not read as "now".
  const openEnded = `(?:${rp.openEnded
    .map((word) => escapeRegex(normalizeText(word)).replace(/\\?\s+/g, String.raw`\s*`))
    .join("|")})(?!${LETTER})`;
  const separator = String.raw`\s*(?:[‐‑‒–—―−~-]|${wordListPattern(rp.rangeWords)})\s*`;

  /**
   * A single point in time, in any of the spellings a resume actually uses.
   *
   * Every year is fenced with `(?<!\d)` / `(?!\d)`. Without the fences "10000-20000 requests"
   * read as the range 0000–2000, because a four-digit run could be taken from the middle of a
   * longer number.
   *
   * A month name is a whole word the policy lists — "Jan", "January", "Sept" — with an
   * optional full stop. Letters after an abbreviation used to be allowed, which read the
   * employer in "Novartis 2018" as November and "Marketing 2019" as March; spelled-out names
   * are listed in the policy instead. `[\s-]*` accepts "Jan-2020" and "Jan2020" as well as
   * "Jan 2020", and the year may be two digits after an apostrophe ("Jan '20"), resolved by
   * `findDateRange`. A season the policy lists ("Spring 2020") is a date too.
   * A day may stand either side of the name — "15 Jan 2020", "15. Jan 2020", "June 1, 2019" —
   * and is skipped: a range read only to the month must still be read, and is otherwise lost
   * whole. The day before the name needs whitespace after it, so the name stays a whole word.
   *
   * Numeric forms, longest first: a full date with a day ("04.05.2021", "05/04/2021",
   * "2021-05-04"), then month and year either way round ("05/2021", "05.2021", "2021-05",
   * "2021/05"), then a bare year. A month-and-year match may not start inside a full date, or
   * "04/05/2021" in the US would read as May.
   */
  const seasons = Object.fromEntries(
    Object.entries(rp.seasons).map(([name, span]) => [normalizeText(name).toLowerCase(), span]),
  );
  const seasonNames = Object.keys(seasons).map(escapeRegex).join("|") || "(?!)";
  const seasonDate = String.raw`(?<!${LETTER})(?:${seasonNames})[\s-]+\d{4}(?!\d)`;
  const date = String.raw`(?:(?:(?<!\d)${DAY_BEFORE})?(?<!${LETTER})(?:${monthNames})\.?[\s-]*(?:${DAY_AFTER}\d{4}(?!\d)|${SHORT_YEAR})|${seasonDate}|(?<!\d)\d{1,2}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{4}(?!\d)|(?<!\d)\d{4}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2}(?!\d)|(?<![\d./-])\d{1,2}\s*[./-]\s*\d{4}(?!\d)|(?<!\d)\d{4}\s*[./-]\s*\d{1,2}(?![\d./-])|(?<!\d)\d{4}(?!\d))`;
  // "since 2019", "seit 03/2019": a start with no end, which is a current role.
  const since = wordListPattern(rp.sinceWords);

  // The end of a range may be a year's last two digits ("2019–21"); `findDateRange` reads them
  // only after a bare year, and against it.
  const shortEnd = String.raw`\d{2}(?![\d./-])`;

  return {
    months,
    seasons,
    // Global so `findDateRange` can move past a candidate that fails the sanity checks and try
    // the next one on the same line.
    // The second branch reads "Jan 2020 to date": there the "to" belongs to the open-ended
    // phrase, so the separator branch consumes it and is left with "date". The last reads a
    // season alone, "Summer 2018": a term, which ends when the season does.
    range: new RegExp(
      String.raw`(${date})(?:${separator}(${date}|${openEnded}|${shortEnd})|\s+(${openEnded}))|${since}\s+(${date})|(${seasonDate})`,
      "giu",
    ),
    named: new RegExp(
      String.raw`^(?:${DAY_BEFORE})?(${monthNames})\.?[\s-]*${DAY_AFTER}(\d{4}|${SHORT_YEAR})$`,
      "u",
    ),
    season: new RegExp(String.raw`^(${seasonNames})[\s-]+(\d{4})$`, "u"),
    openEnded: new RegExp(`^${openEnded}$`, "iu"),
  };
});

/**
 * One date as written. A year written in two digits ("Jan '20", or "21" ending "2019–21") comes
 * back as those two digits, for `findDateRange` to place; on its own it is no plausible year.
 * A season is read as its first month at the start of a range and its last at the end.
 */
export function parseDate(
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

  // A full date. Only its month is kept; which number that is depends on the region's order,
  // unless one of the two is over 12 and so can only be the day.
  const full = value.match(/^(\d{1,4})\s*[./-]\s*(\d{1,2})\s*[./-]\s*(\d{1,4})$/);
  if (full) {
    const [first, second, third] = full.slice(1).map(Number);
    if (full[1].length === 4) return month(second) ? { year: first, month: second } : null;
    if (full[3].length !== 4) return null;
    const dayFirst = first > 12 ? true : second > 12 ? false : rp.dateOrder === "DMY";
    const m = month(dayFirst ? second : first);
    return m ? { year: third, month: m } : null;
  }

  const numeric = value.match(/^(\d{1,2})\s*[./-]\s*(\d{4})$/);
  if (numeric && month(Number(numeric[1])))
    return { year: Number(numeric[2]), month: Number(numeric[1]) };

  // ISO-ish "2021-03", which is how a Studio document serialises its dates, and "2021/03".
  const iso = value.match(/^(\d{4})\s*[./-]\s*(\d{1,2})$/);
  if (iso && month(Number(iso[2]))) return { year: Number(iso[1]), month: Number(iso[2]) };

  if (YEAR_ONLY.test(value)) return { year: Number(value), month: null };
  return null;
}

/**
 * The years a resume date can plausibly name. Anything outside is a number that happens to sit
 * either side of a dash or a "to" — "from 1000 to 5000 users" was recovered as a job running
 * from the year 1000 to the year 5000, and 24,000 months of experience with it.
 */
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
 * A date from a structured document field: `YYYY-MM-DD`, `YYYY-MM` or `YYYY`, or failing that
 * any spelling the policy's own date vocabulary reads. Held to the same plausibility bounds as
 * a parsed date, so a typo'd year in an editor field is reported as missing rather than scored.
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

/** A date written with a two-digit year: "21", "Jan '20". "0000" is a four-digit one. */
const TWO_DIGIT_YEAR = /(?:^|['’‘])\d{2}$/u;

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

/** A missing month is read generously: January for a start, December for an end. */
function toIndex(date: AtsParsedDate, edge: "start" | "end") {
  return date.year * 12 + (date.month ?? (edge === "start" ? 1 : 12));
}

/**
 * The first date range on the line that reads as an actual span of time.
 *
 * A candidate is skipped rather than returned when either end is unreadable, a year falls
 * outside [1950, now + 10], or the range runs backwards. Later candidates on the same line are
 * still tried, so a header like "Engineer 2010 · 2019 - 2022" is not lost to its first number.
 *
 * Two-digit years are placed here: a start's ("Jan '20") in the century that keeps it no later
 * than ten years ahead of `now`, an end's in the first year on or after the start that ends in
 * those digits ("2019–21", "1998–02"). A bare two-digit end follows only a bare year, and not
 * after an unspaced hyphen when it could be a month: "2021-03" is March.
 */
export function findDateRange(
  line: string,
  rp: AtsEnginePolicy["resumeParse"],
  now: Date = new Date(),
): { range: DateRange; matched: string } | null {
  const matchers = buildMatchers(rp);

  for (const match of line.matchAll(matchers.range)) {
    // Group 4 is the "since 2019" branch: a start alone, which is a role still held. Group 5 is
    // a season alone, "Summer 2018": a term that starts and ends with the season.
    if (match[5] !== undefined) {
      const start = parseDate(match[5], rp, "start");
      const end = parseDate(match[5], rp, "end");
      if (!isPlausibleDate(start, now) || !isPlausibleDate(end, now)) continue;
      return { range: { start, end, current: false }, matched: match[0] };
    }
    const endText = match[2] ?? match[3];
    const current = match[4] !== undefined || matchers.openEnded.test(endText.trim());
    const startText = match[1] ?? match[4];
    const parsedStart = parseDate(startText, rp);
    const start = TWO_DIGIT_YEAR.test(startText.trim())
      ? withCentury(parsedStart, now.getUTCFullYear() + YEARS_AHEAD)
      : parsedStart;
    if (!current && /^\d{2}$/.test(endText.trim())) {
      if (!YEAR_ONLY.test(startText.trim())) continue;
      if (/^\d{4}-\d{2}$/.test(match[0].trim()) && Number(endText) <= 12) continue;
    }
    const parsedEnd = current ? null : parseDate(endText, rp, "end");
    const end =
      start && parsedEnd && TWO_DIGIT_YEAR.test(endText.trim())
        ? afterStart(parsedEnd, start.year)
        : parsedEnd;

    if (!isPlausibleDate(start, now)) continue;
    if (!current && (!isPlausibleDate(end, now) || toIndex(end, "end") < toIndex(start, "start")))
      continue;

    return { range: { start, end, current }, matched: match[0] };
  }
  return null;
}
