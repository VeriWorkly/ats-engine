/**
 * @veriworkly/ats-engine/format — presentation helpers for ATS reports.
 *
 * Dependency-free and policy-free, so a browser bundle can import it without the scorer. Display
 * only: nothing changes a score. English only.
 */

import type {
  AtsAdvice,
  AtsIscedLevel,
  AtsParsedCertification,
  AtsParsedDate,
  AtsParsedLanguage,
  AtsParsedRole,
} from "../types.js";
import { monthIndex, nowMonth } from "../util/months.js";
import { own } from "../util/own.js";

/** The display band of a score: `scoreTone`. */
export type AtsScoreTone = "good" | "warn" | "bad";

/**
 * Lower bounds of the display bands, equal to `VERDICT_BANDS` in the main entry ("good" is the
 * verdict's "strong"). Copied to keep `/format` dependency-free; a test holds the two equal.
 */
export const SCORE_BANDS = /* @__PURE__ */ Object.freeze({ good: 75, warn: 45 } as const);

/** "good" from 75, "warn" from 45, "bad" below: the bands of `SCORE_BANDS`. */
export function scoreTone(score: number): AtsScoreTone {
  if (score >= SCORE_BANDS.good) return "good";
  if (score >= SCORE_BANDS.warn) return "warn";
  return "bad";
}

/** Category ids in report order: integrity leads (it outweighs the rest), writing comes last. */
export const CATEGORY_ORDER = /* @__PURE__ */ Object.freeze([
  "integrity",
  "parse",
  "contact",
  "structure",
  "content",
  "format",
  "writing",
] as const);

/** What each category id is called on a report ("content" is "Evidence"). */
export const CATEGORY_LABELS: Readonly<Record<string, string>> = /* @__PURE__ */ Object.freeze({
  parse: "Parsing",
  contact: "Contact & links",
  structure: "Structure",
  content: "Evidence",
  format: "Format risk",
  integrity: "Integrity",
  writing: "Writing",
});

/** An unknown category is title-cased, not hidden. */
export function categoryLabel(category: string) {
  return own(CATEGORY_LABELS, category) ?? category.charAt(0).toUpperCase() + category.slice(1);
}

/** Known categories first in `CATEGORY_ORDER`, unknown ones after, each group stable. */
export function sortByCategoryOrder<T extends { category: string }>(items: readonly T[]): T[] {
  const rank = (category: string) => {
    const index = (CATEGORY_ORDER as readonly string[]).indexOf(category);
    return index === -1 ? CATEGORY_ORDER.length : index;
  };
  return [...items].sort((a, b) => rank(a.category) - rank(b.category));
}

/** Labels of the kinds of advice (`report.advice`), which is shown apart from the score. */
export const ADVICE_LABELS: Readonly<Record<AtsAdvice["kind"], string>> =
  /* @__PURE__ */ Object.freeze({
    file: "File",
    age: "Age",
    ats: "ATS",
  });

/** The label of an advice kind ("File", "Age", "ATS"); an unknown kind as it is. */
export function adviceLabel(kind: AtsAdvice["kind"]) {
  return own(ADVICE_LABELS, kind) ?? kind;
}

const MONTH_LABELS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** "Mar 2021", or "2021" when only the year is known, or `null` when there is no date. */
export function formatParsedDate(date: AtsParsedDate | null): string | null {
  if (!date) return null;
  // A month outside 1–12 reads as the year alone.
  const month = date.month ? MONTH_LABELS[date.month - 1] : undefined;
  return month ? `${month} ${date.year}` : String(date.year);
}

/** "Mar 2021 – Present", "2018 – 2020", or `null` when the role has no start. */
export function formatRoleDates(role: Pick<AtsParsedRole, "start" | "end" | "current">) {
  const from = formatParsedDate(role.start);
  if (!from) return null;
  const to = role.current ? "Present" : (formatParsedDate(role.end) ?? "?");
  return `${from} – ${to}`;
}

/** "PMP, PMI, Mar 2021, expires 2027": a certification row on one line. */
export function formatCertification(row: AtsParsedCertification): string {
  const earned = formatParsedDate(row.date);
  const expires = formatParsedDate(row.expires);
  return [row.name, row.issuer, earned, expires && `expires ${expires}`].filter(Boolean).join(", ");
}

/** "German (B2)", "German (fluent)", or the language alone when no level was read. */
export function formatSpokenLanguage(row: AtsParsedLanguage): string {
  return row.level ? `${row.language} (${row.level})` : row.language;
}

/** "3 yr 2 mo", "3 yr", "7 mo". Whole months; anything not a positive number reads as "0 mo". */
export function formatTenure(months: number): string {
  const whole = Number.isFinite(months) && months > 0 ? Math.round(months) : 0;
  const years = Math.floor(whole / 12);
  const rest = whole % 12;
  if (!years) return `${rest} mo`;
  return rest ? `${years} yr ${rest} mo` : `${years} yr`;
}

/**
 * Calendar months one role spans, inclusive of both ends. A current role runs to `now`; a role
 * with only a start counts as one month. A missing start month is January, a missing end month
 * December, as in the parser.
 */
export function roleSpanMonths(
  role: Pick<AtsParsedRole, "start" | "end" | "current">,
  now: Date = new Date(),
): number {
  if (!role.start) return 0;
  const from = monthIndex(role.start);
  const to = role.current ? nowMonth(now) : role.end ? monthIndex(role.end, 12) : from;
  return Math.max(0, to - from + 1);
}

/** What each ISCED 2011 level is called on a report. */
export const ISCED_LABELS: Readonly<Record<AtsIscedLevel, string>> = /* @__PURE__ */ Object.freeze({
  2: "Lower secondary",
  3: "Upper secondary",
  4: "Post-secondary",
  5: "Short-cycle tertiary",
  6: "Bachelor's or equivalent",
  7: "Master's or equivalent",
  8: "Doctorate",
});

/** Control characters (a raw escape sequence can recolour or clear a terminal); line breaks and tabs stay. */
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g; // eslint-disable-line no-control-regex

/** Every string in `value`, at any depth, with control characters removed (JSON does not escape C1). */
export function printable<T>(value: T): T {
  if (typeof value === "string") return value.replace(CONTROLS, "") as T;
  if (Array.isArray(value)) return value.map(printable) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, printable(child)]),
    ) as T;
  return value;
}
