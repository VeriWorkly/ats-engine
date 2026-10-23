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

// "Reacted" met React and "R&D" met R: cutting a verb's ending made it a named skill.
describe("a verb is not the named skill its stem spells", () => {
  const judged = (bullets: string[], asks: string[]) =>
    check(
      `Kai Moreno\nkai@example.com\nExperience\nSupport Engineer, Bluebird\nJan 2020 - Present\n${bullets.map((b) => `- ${b}`).join("\n")}`,
      DEFAULT_POLICY,
      {
        now: new Date("2026-10-01T00:00:00Z"),
        jobDescription: `Requirements\n${asks.map((a) => `- ${a}`).join("\n")}`,
      },
    ).requirements.map((r) => r.status);

  it("does not meet React, Spark, Rust or R with Reacted, Sparked, rusted or R&D", () => {
    expect(
      judged(
        [
          "Reacted to 40 outages a month",
          "Sparked a redesign of the on-call rota",
          "Replaced rusted runbooks",
          "Led R&D for 3 product lines",
        ],
        ["React", "Spark", "Rust", "R"],
      ),
    ).toEqual(["missing", "missing", "missing", "missing"]);
  });

  // The "&" rule dropped a skill glued to another skill.
  it("meets each of two skills joined by &, but not a letter of an abbreviation", () => {
    expect(
      judged(
        ["Wrote C&C++ firmware", "Built AI&ML pipelines", "Ran Q&A and M&A reviews", "Led R&D"],
        ["Experience with C", "AI", "ML", "R"],
      ),
    ).toEqual(["met", "met", "met", "missing"]);
  });

  // Dropping the letters of "P&L" on the posting side too left its ask with nothing to match.
  it("meets an abbreviation joined by & by the same abbreviation", () => {
    expect(
      judged(
        [
          "Owned the P&L for a $40M business unit",
          "Led M&A due diligence on 6 acquisitions",
          "Worked in R&D",
        ],
        [
          "P&L responsibility",
          "P&L ownership",
          "Full P&L accountability",
          "M&A experience",
          "Q&A",
          "R&D",
        ],
      ),
    ).toEqual(["met", "met", "met", "met", "missing", "met"]);
  });

  it("still meets a skill by its plural, and a plain word by its other forms", () => {
    expect(
      judged(
        ["Built REST APIs in React and Spark", "Tested 3 services in R"],
        ["API design", "React", "Spark", "Testing", "R"],
      ),
    ).toEqual(["met", "met", "met", "met", "met"]);
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
