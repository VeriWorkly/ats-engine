import { findDateRange } from "../parser/dates.js";
import { sectionKind, segmentResume } from "../parser/sections.js";
import type { AtsEnginePolicy } from "../policy/schema.js";
import { BULLET, wordListPattern } from "../text/text.js";
import { memo } from "../util/memo.js";

/**
 * No plausibility ceiling on years: these helpers only ask whether a line is shaped like a dated
 * header.
 */
export const ANY_YEAR = new Date(Date.UTC(9999, 0, 1));

/** Whether a line carries a role's date range. A bullet's numbers are achievements, never one. */
export function isDatedLine(line: string, policy: AtsEnginePolicy, now: Date = ANY_YEAR) {
  return !BULLET.test(line) && findDateRange(line, policy.resumeParse, now) !== null;
}

const LETTER_WORD = /^[\p{L}]/u;
const CAPITALIZED = /^\p{Lu}/u;

/**
 * Whether a line reads as a sentence, not a header: at least a third of its words start in lower
 * case ("Led the migration of 40 services" does, "Senior Software Engineer" does not). Letters
 * without case (Devanagari) count as lower case.
 */
export function readsAsSentence(line: string) {
  const lettered = line.split(/\s+/).filter((word) => LETTER_WORD.test(word));
  if (lettered.length < 3) return false;
  const lower = lettered.filter((word) => !CAPITALIZED.test(word)).length;
  return lower * 3 >= lettered.length;
}

/**
 * The sentences below a role's dated line in an experience or projects section, for a resume
 * whose list markers did not survive extraction (Chrome draws `<ul>` markers as paths). Empty
 * when no role is dated.
 */
export function roleBodyLines(lines: readonly string[], policy: AtsEnginePolicy): string[] {
  const body: string[] = [];
  for (const section of segmentResume([...lines], policy)) {
    if (section.kind !== "experience" && section.kind !== "projects") continue;
    let inRole = false;
    for (const line of section.lines) {
      if (isDatedLine(line, policy)) inRole = true;
      else if (inRole && readsAsSentence(line)) body.push(line);
    }
  }
  return body;
}

const citationHeading = memo(
  (text: AtsEnginePolicy["text"]) =>
    // Schema-defaulted; a hand-built policy may lack it.
    new RegExp(`^${wordListPattern(text.citationHeadings ?? ["(?!)"])}`, "iu"),
);

/**
 * What a citation carries: a year, a quoted title, "et al." or author initials ("Doe J,", "J.
 * Doe").
 */
const CITATION_SIGNS = [
  /(?<!\d)(?:19|20)\d{2}(?!\d)/u,
  /["“”]/u,
  /(?<![\p{L}])et\s+al(?![\p{L}])/u,
  /(?<![\p{L}])\p{Lu}\.\s?\p{Lu}|(?<![\p{L}])\p{Lu}\p{Ll}+,?\s\p{Lu}{1,2}[,.]/u,
];
const CITATION = new RegExp(CITATION_SIGNS.map((sign) => sign.source).join("|"), "u");

/**
 * The citations carrying two of those signs; a year alone ("Kubernetes alpha project 2021") is not
 * one.
 */
export const fullCitations = (cited: ReadonlySet<string>) =>
  new Set(
    [...cited].filter((line) => CITATION_SIGNS.filter((sign) => sign.test(line)).length >= 2),
  );

/** Citation-shaped lines under a heading that opens a list of works (`text.citationHeadings`). */
export function citationLines(lines: readonly string[], policy: AtsEnginePolicy) {
  const heading = citationHeading(policy.text);
  const found = new Set<string>();
  let listing = false;
  for (const line of lines) {
    const kind = sectionKind(line, policy);
    if (kind !== null) listing = kind === "other" && heading.test(line.trim());
    else if (listing && CITATION.test(line)) found.add(line);
  }
  return found;
}
