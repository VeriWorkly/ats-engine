import { classifyHeading, headingConnector, type HeadingMatchers } from "../parser/sections.js";
import type { AtsEnginePolicy } from "../policy/schema.js";
import { policyRegex } from "../policy/regex.js";
import { BULLET_PREFIX, wordListPattern, wordListRegex } from "../text/text.js";
import { memo } from "../util/memo.js";

export type JobSectionKind = "required" | "preferred" | "responsibilities" | "body" | "excluded";

/** `heading` is the line that opened the block, when one did: "About Acme Robotics". */
export type JobSection = { kind: JobSectionKind; text: string; heading?: string };

/**
 * Splits a job posting into labelled blocks, each running from its heading to the *next*
 * heading.
 *
 * The previous implementation took a fixed 600-character window after a "Requirements" heading.
 * On a normally formatted posting that window overshoots the requirements list and swallows the
 * nice-to-haves and responsibilities that follow it, so optional skills were billed at the
 * required weight and the preferred discount could never apply. Terminating at the next heading
 * is both simpler and correct at any section length.
 *
 * A posting with no recognisable headings yields a single `body` block. That is intentional:
 * scoring still works, and the specificity weighting below is what keeps boilerplate in check.
 */
export function segmentJob(jobText: string, policy: AtsEnginePolicy): JobSection[] {
  const km = policy.keywordMatch;
  const matchers: HeadingMatchers<JobSectionKind> = {
    kinds: [
      { kind: "required", re: policyRegex(km.sections.required, "i") },
      { kind: "preferred", re: policyRegex(km.sections.preferred, "i") },
      { kind: "responsibilities", re: policyRegex(km.sections.responsibilities, "i") },
      { kind: "excluded", re: policyRegex(km.sections.excluded, "i") },
    ],
    connector: headingConnector(policy.resumeParse),
  };

  const sections: JobSection[] = [];
  let current: JobSection = { kind: "body", text: "" };

  for (const rawLine of jobText.split(/\r?\n/)) {
    const line = rawLine.trim();
    // A heading is a short standalone line. Requiring that shape stops a requirement written as
    // prose ("...you will be responsible for...") from re-labelling everything after it.
    const heading = classifyHeading(line, matchers);
    if (!heading) {
      current.text += `${line}\n`;
      continue;
    }
    if (current.text.trim()) sections.push(current);
    current = {
      kind: heading.kind,
      text: heading.rest ? `${heading.rest}\n` : "",
      heading: line.split(":")[0]!.trim(),
    };
  }
  if (current.text.trim()) sections.push(current);

  return sections;
}

/**
 * An amount of money: "$175,000", "€80k", "90,000 EUR". A figure is read from the start of its
 * digit run only, so a long run of digits costs one pass, not one per digit.
 */
const MONEY = /[$€£₹¥]\s?\d|(?<![\d,.])\d[\d,.]*\s?(?:k\b|usd|eur|gbp|inr)/i;

const offerMatchers = memo((km: AtsEnginePolicy["keywordMatch"]) => ({
  // As a label: "Benefits:", "Salary range:", or the whole line ("Compensation").
  label: new RegExp(`^${wordListPattern(km.offerWords)}(?:\\s+\\p{L}+)?\\s*(?:[:：]|$)`, "iu"),
  word: wordListRegex(km.offerWords),
}));

/**
 * What the posting offers (pay, benefits), which is not something it asks of the candidate: a
 * line labelled with an offer word, or naming one beside an amount of money. An offer word alone
 * is not enough: "Compensation analysis experience" and "Equity research" are requirements.
 */
export function isOfferLine(line: string, policy: AtsEnginePolicy) {
  const text = line.replace(BULLET_PREFIX, "").trim();
  const { label, word } = offerMatchers(policy.keywordMatch);
  return label.test(text) || (MONEY.test(text) && word.test(text));
}

const ignorePatternsOf = memo((patterns: readonly string[]) =>
  patterns.map((pattern) => policyRegex(pattern, "gu")),
);

/** A posting line without the text that is never a keyword or an ask: a "Boston, MA" location. */
export function withoutIgnored(line: string, policy: AtsEnginePolicy) {
  let text = line;
  for (const re of ignorePatternsOf(policy.keywordMatch.ignorePatterns))
    text = text.replace(re, (found) => " ".repeat(found.length));
  return text;
}
