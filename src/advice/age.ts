import type { AtsEnginePolicy } from "../policy/schema.js";
import { policyRegex } from "../policy/regex.js";
import type { AtsAdvice, AtsParsedResume } from "../types.js";
import { memo } from "../util/memo.js";
import { adviceItem } from "./file.js";

/**
 * Age signals: a graduation year and a count of years that let a reader work out a candidate's
 * age. Given only where the policy as localised sets the thresholds — a region pack's
 * `ageAdvice` — and never scored.
 */

const phrasePatterns = memo((age: AtsEnginePolicy["advice"]["age"]) =>
  age.experiencePatterns.map((pattern) => policyRegex(pattern, "gi")),
);

/** The first stated total of years past `years`, as written: "30+ years of experience". */
function statedTotal(
  lines: readonly string[],
  age: AtsEnginePolicy["advice"]["age"],
  years: number,
) {
  for (const pattern of phrasePatterns(age))
    for (const line of lines)
      for (const match of line.matchAll(pattern))
        if (Number(match[1]) > years) return match[0].replace(/\s+/g, " ").trim();
  return null;
}

export function ageAdvice(
  policy: AtsEnginePolicy,
  parsed: AtsParsedResume,
  lines: readonly string[],
  now: Date,
): AtsAdvice[] {
  const { age, messages } = policy.advice;
  const advice: AtsAdvice[] = [];
  const year = now.getUTCFullYear();

  if (age.graduationYears !== undefined) {
    // Years already past: an expected graduation says nothing about age.
    const dates = [
      ...new Set(
        parsed.education
          .map((row) => row.end?.year)
          .filter((end): end is number => end !== undefined && year - end > age.graduationYears!),
      ),
    ].sort((a, b) => a - b);
    if (dates.length)
      advice.push(
        adviceItem("age.graduationYear", "age", messages.graduationYear, {
          years: age.graduationYears,
          dates: dates.join(", "),
        }),
      );
  }

  if (age.experienceYears !== undefined) {
    const phrase = statedTotal(lines, age, age.experienceYears);
    const dated = Math.floor((parsed.monthsOfExperience ?? 0) / 12);
    if (phrase !== null || dated > age.experienceYears)
      advice.push(
        adviceItem(
          "age.experienceYears",
          "age",
          messages.experienceYears,
          { years: age.experienceYears, phrase: phrase ?? "", n: dated },
          phrase === null ? messages.experienceHistory : messages.experienceYears.evidence,
        ),
      );
  }
  return advice;
}
