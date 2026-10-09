import { describe, expect, it } from "vitest";

import { check, DEFAULT_POLICY } from "../../src/index.js";
import { stem } from "../../src/text/text.js";

const rules = DEFAULT_POLICY.keywordMatch.stemming;

describe("a Greek plural meets its singular", () => {
  it.each([
    ["analysis", "analyses"],
    ["paralysis", "paralyses"],
    ["hypothesis", "hypotheses"],
    ["synthesis", "syntheses"],
    ["diagnosis", "diagnoses"],
    ["prognosis", "prognoses"],
  ])("%s and %s", (singular, plural) => {
    expect(stem(singular, rules)).toBe(stem(plural, rules));
  });

  it.each([
    ["response", "responses"],
    ["close", "closes"],
    ["process", "processes"],
    ["database", "databases"],
    ["case", "cases"],
  ])("leaves %s and %s meeting as before", (singular, plural) => {
    expect(stem(singular, rules)).toBe(stem(plural, rules));
  });

  it("counts statistical analyses for a statistical analysis requirement", () => {
    const report = check(
      [
        "Jane Doe",
        "jane.doe@example.com",
        "Experience",
        "Analyst, Acme",
        "Jan 2020 - Present",
        "- Ran statistical analyses of churn.",
      ].join("\n"),
      DEFAULT_POLICY,
      {
        now: new Date("2026-10-01T00:00:00Z"),
        jobDescription: "Requirements\n- Statistical analysis\n- SQL\n- Excel",
      },
    );
    expect(report.missingKeywords).not.toContain("analysis");
  });
});
