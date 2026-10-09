/**
 * @veriworkly/ats-engine/format — presentation helpers for ATS reports.
 *
 * Dependency-free and policy-free, so a browser bundle can import it without pulling in the
 * scorer or its schema library. Everything here is display: nothing changes a score.
 *
 * English only: labels are literals, to be taken as parameters when a second locale ships.
 */

import type {
  AtsAdvice,
  AtsDegreeLevel,
  AtsIscedLevel,
  AtsParsedCertification,
  AtsParsedDate,
  AtsParsedLanguage,
  AtsParsedRole,
} from "../types.js";
import { own } from "../util/own.js";

/** The display band of a score: `scoreTone`. */
export type AtsScoreTone = "good" | "warn" | "bad";

/**
 * Lower bounds of the display bands: the verdict's own (`VERDICT_BANDS` in the main entry), so a
 * score labelled "good" here is one the verdict calls "strong". Copied rather than imported to keep
 * `/format` free of dependencies; `tests/format/format.test.ts` holds the two equal.
 */
export const SCORE_BANDS = { good: 75, warn: 45 } as const;

/** "good" from 75, "warn" from 45, "bad" below: the bands of `SCORE_BANDS`. */
export function scoreTone(score: number): AtsScoreTone {
  if (score >= SCORE_BANDS.good) return "good";
  if (score >= SCORE_BANDS.warn) return "warn";
  return "bad";
}

/**
 * Category ids in the order a report reads best: can it be trusted, read, found, navigated,
 * believed, and then how well it reads. Integrity leads because a finding there outweighs
 * everything below it; writing style comes last because no ATS filters on it.
 */
export const CATEGORY_ORDER = [
  "integrity",
  "parse",
  "contact",
  "structure",
  "content",
  "format",
  "writing",
] as const;

/** What each category id is called on a report: "content" is "Evidence", "format" "Format risk". */
export const CATEGORY_LABELS: Readonly<Record<string, string>> = {
  parse: "Parsing",
  contact: "Contact & links",
  structure: "Structure",
  content: "Evidence",
  format: "Format risk",
  integrity: "Integrity",
  writing: "Writing",
};

/** A policy may define categories this list does not know; they are title-cased, not hidden. */
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
export const ADVICE_LABELS: Readonly<Record<AtsAdvice["kind"], string>> = {
  file: "File",
  age: "Age",
  ats: "ATS",
};

/** The label of an advice kind ("File", "Age", "ATS"); an unknown kind as it is. */
export function adviceLabel(kind: AtsAdvice["kind"]) {
  return own(ADVICE_LABELS, kind) ?? kind;
}

const MONTH_LABELS = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** "Mar 2021", or "2021" when only the year is known, or `null` when there is no date. */
export function formatParsedDate(date: AtsParsedDate | null): string | null {
  if (!date) return null;
  // A month outside 1–12 (from hand-built input) reads as the year alone, never "undefined 2021".
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
 * with only a start counts as that one month. A missing start month reads as January and a
 * missing end month as December, the generous reading the parser also uses.
 */
export function roleSpanMonths(
  role: Pick<AtsParsedRole, "start" | "end" | "current">,
  now: Date = new Date(),
): number {
  if (!role.start) return 0;
  const from = role.start.year * 12 + (role.start.month ?? 1) - 1;
  const to = role.current
    ? now.getUTCFullYear() * 12 + now.getUTCMonth()
    : role.end
      ? role.end.year * 12 + (role.end.month ?? 12) - 1
      : from;
  return Math.max(0, to - from + 1);
}

/**
 * What each `AtsDegreeLevel` was called on a report.
 *
 * @deprecated Use `ISCED_LABELS`; removed in 1.0.
 */
export const DEGREE_LABELS: Readonly<Record<AtsDegreeLevel, string>> = {
  diploma: "Diploma",
  associate: "Associate",
  bachelor: "Bachelor's",
  master: "Master's",
  doctorate: "Doctorate",
};

/**
 * What each ISCED 2011 level is called on a report. Short and international: "Bachelor's or
 * equivalent" is true of a B.Tech, a Licence and a Bachelor alike.
 */
export const ISCED_LABELS: Readonly<Record<AtsIscedLevel, string>> = {
  2: "Lower secondary",
  3: "Upper secondary",
  4: "Post-secondary",
  5: "Short-cycle tertiary",
  6: "Bachelor's or equivalent",
  7: "Master's or equivalent",
  8: "Doctorate",
};

/**
 * Control characters, which text from a resume, a posting or a model can carry: an escape
 * sequence printed raw recolours the terminal, clears it, or sets its title. Line breaks and tabs
 * stay.
 */
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g; // eslint-disable-line no-control-regex

/**
 * Every string in `value`, at any depth, made safe to print in a terminal: control characters
 * removed. JSON escapes C0 controls but not C1 (U+0080–U+009F), which a terminal still acts on.
 */
export function printable<T>(value: T): T {
  if (typeof value === "string") return value.replace(CONTROLS, "") as T;
  if (Array.isArray(value)) return value.map(printable) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, printable(child)]),
    ) as T;
  return value;
}
