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

describe("a framework's .js name and a British spelling meet their other forms", () => {
  const vocab = buildVocabulary(km);
  const canonical = (word: string) => canonicalize(word, km, vocab);

  it.each([
    ["vue.js", "vue"],
    ["nuxt.js", "nuxt"],
    ["node.js", "node", "nodejs"],
    ["react.js", "react", "reactjs"],
    ["angular.js", "angularjs"],
    ["full-stack", "fullstack"],
    ["modelling", "modeling", "modelled", "modeled", "model"],
    ["labelling", "labeling", "labelled", "labeled", "label"],
    ["travelling", "traveling", "travelled", "traveled", "travel"],
    ["optimisation", "optimization", "optimisations", "optimizations"],
    ["optimise", "optimize", "optimised", "optimized", "optimising", "optimizing", "optimises"],
    ["organisation", "organization", "organisations", "organizations"],
    ["organiser", "organizer", "organisers"],
    ["analyse", "analyze", "analysed", "analyzed", "analysing", "analyzing", "analyzes"],
    ["analysis", "analyses", "analyse", "analysed", "analyze", "analyzed"],
    ["behaviour", "behavior", "behaviours", "behaviors"],
    ["behavioural", "behavioral"],
    ["colour", "color", "colours"],
  ])("%s", (...forms) => {
    expect(new Set(forms.map(canonical)).size).toBe(1);
  });

  it.each([
    ["angular.js", "angular"],
    // ".js" names an ordinary word too: "the next release", "expressed concerns".
    ["next.js", "next"],
    ["express.js", "expressed"],
    ["solid.js", "solid"],
    ["tensorflow.js", "tensorflow"],
    ["excel", "excelled"],
    ["excel", "excelling"],
    ["hour", "hor"],
    ["sell", "sel"],
  ])("keeps %s apart from %s", (a, b) => {
    expect(canonical(a)).not.toBe(canonical(b));
  });

  it.each([
    ["rise", "rises"],
    ["raise", "raises", "raising", "raised"],
    ["enterprise", "enterprises"],
    ["hour", "hours"],
    ["tour", "tours"],
    ["selling", "sell", "sells"],
  ])("still folds %s with its own forms", (...forms) => {
    expect(new Set(forms.map(canonical)).size).toBe(1);
  });

  it("keeps three.js a keyword, not the number word three", () => {
    expect(canonical("three.js")).not.toBeNull();
  });

  it("does not meet Next.js with the next release, nor Advanced Excel with excelled", () => {
    const report = check(
      `Kai Moreno
kai@example.com
Experience
Frontend Engineer, Bluebird
Jan 2020 - Present
- Planned the next release for 3 clients
- Excelled at stakeholder management`,
      DEFAULT_POLICY,
      {
        now: new Date("2026-10-01T00:00:00Z"),
        jobDescription: "Requirements\n- Next.js\n- Advanced Excel",
      },
    );
    expect(report.requirements.map((r) => r.status)).toEqual(["missing", "missing"]);
  });

  it("meets Vue, Next.js, full stack and modeling in either spelling", () => {
    const resume = (skills: string) =>
      `Kai Moreno\nkai@example.com\nExperience\nFrontend Engineer, Bluebird\nJan 2020 - Present\n- Built apps for 3 clients\nSkills\n${skills}`;
    for (const [has, asks] of [
      ["Vue.js, Next.js, full stack, modelling", "Vue, Next.js, Full-stack, Modeling"],
      ["Vue, Next.js, Full-stack, modeling", "Vue.js, Next.js, Full stack, Modelling"],
    ] as const) {
      const report = check(resume(has), DEFAULT_POLICY, {
        now: new Date("2026-10-01T00:00:00Z"),
        jobDescription: `Requirements\n${asks.replace(/^|, /g, "\n- ").trim()}`,
      });
      expect(report.missingKeywords, has).toEqual([]);
      expect(
        report.requirements.map((r) => r.status),
        has,
      ).toEqual(["met", "met", "met", "met"]);
    }
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
