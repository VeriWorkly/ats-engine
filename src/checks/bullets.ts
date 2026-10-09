import { findDateRange } from "../parser/dates.js";
import { segmentResume } from "../parser/sections.js";
import type { AtsEnginePolicy } from "../policy/schema.js";
import { BULLET } from "../text/text.js";

/**
 * Any year a resume could print. These helpers only ask whether a line is shaped like a role's
 * dated header, so the clock's plausibility ceiling adds nothing, and leaving it out keeps the
 * result a function of the text.
 */
export const ANY_YEAR = new Date(Date.UTC(9999, 0, 1));

/** Whether a line carries a role's date range. A bullet's numbers are achievements, never one. */
export function isDatedLine(line: string, policy: AtsEnginePolicy, now: Date = ANY_YEAR) {
  return !BULLET.test(line) && findDateRange(line, policy.resumeParse, now) !== null;
}

const LETTER_WORD = /^[\p{L}]/u;
const CAPITALIZED = /^\p{Lu}/u;

/**
 * Whether a line reads as a sentence rather than a header: at least a third of its words start
 * in lower case. "Senior Software Engineer", "Northwind Payments | San Francisco, CA" and
 * "Softwareentwickler bei Nordwind GmbH" do not; "Led the migration of 40 services" and
 * "Entwicklung von Microservices" do. Letters without case (Devanagari) count as lower case.
 */
export function readsAsSentence(line: string) {
  const lettered = line.split(/\s+/).filter((word) => LETTER_WORD.test(word));
  if (lettered.length < 3) return false;
  const lower = lettered.filter((word) => !CAPITALIZED.test(word)).length;
  return lower * 3 >= lettered.length;
}

/**
 * The lines describing work inside a role, for a resume whose list markers did not survive
 * extraction (Chrome draws `<ul>` markers as paths, so a printed PDF has no "•" to find): in an
 * experience or projects section, below a role's dated line, and written as a sentence rather
 * than as the next role's title, employer or city. Empty when there is no dated role to anchor
 * on, and the caller falls back to its own reading.
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
