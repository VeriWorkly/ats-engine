import { describe, expect, it } from "vitest";

import { check, DEFAULT_POLICY } from "../../src/index.js";
import { buildVocabulary, canonicalize } from "../../src/matching/vocabulary.js";
import { stem } from "../../src/text/text.js";

const km = DEFAULT_POLICY.keywordMatch;
const rules = km.stemming;

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

describe("a word ending in a silent e folds with its other forms", () => {
  it.each([
    ["nurse", "nurses", "nursing", "nursed"],
    ["schedule", "schedules", "scheduling", "scheduled"],
    ["price", "prices", "pricing", "priced"],
    ["close", "closes", "closing", "closed"],
    ["trade", "trades", "trading", "traded"],
    ["manage", "manages", "managing", "managed"],
    ["house", "houses", "housing", "housed"],
    ["cause", "causes", "causing", "caused"],
    ["release", "releases", "releasing", "released"],
    ["cache", "caches", "caching", "cached"],
    ["service", "services", "servicing", "serviced"],
    ["change", "changes", "changing", "changed"],
    ["license", "licenses", "licensing", "licensed"],
    ["queue", "queues", "queuing", "queued"],
    ["scale", "scales", "scaling", "scaled"],
    ["theme", "themes"],
    ["machine", "machines"],
    ["pipeline", "pipelines"],
    ["database", "databases"],
    ["employee", "employees"],
    ["focus", "focused", "focusing"],
    ["code", "codes"],
    ["process", "processes", "processing", "processed"],
    ["status", "statuses"],
    ["bus", "buses"],
    ["api", "apis"],
  ])("%s", (...forms) => {
    expect(new Set(forms.map((form) => stem(form, rules))).size).toBe(1);
  });
});

describe("words the rules keep apart", () => {
  it.each([
    ["account", "accounting"],
    ["market", "marketing"],
    ["engine", "engineer"],
    ["note", "not"],
    ["code", "cod"],
    ["theme", "them"],
    ["these", "theses"],
    ["chinese", "chin"],
    ["use", "us"],
    ["process", "processor"],
  ])("%s and %s", (a, b) => {
    expect(stem(a, rules)).not.toBe(stem(b, rules));
  });

  it("makes no word a stopword by folding it onto one", () => {
    const vocab = buildVocabulary(km);
    for (const word of [
      "theme",
      "themes",
      "note",
      "notes",
      "thesis",
      "theses",
      "nursing",
      "pricing",
      "scheduling",
      "housing",
      "mining",
      "accounting",
      "marketing",
    ])
      expect(canonicalize(word, km, vocab), word).not.toBeNull();
  });
});
