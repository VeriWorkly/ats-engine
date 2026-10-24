import { describe, expect, it } from "vitest";

import {
  AtsPolicyError,
  DEFAULT_POLICY,
  computeVerdict,
  parseAtsPolicy,
  check,
  type AtsResumeInput,
} from "../../src/index.js";
import * as ai from "../../src/ai/index.js";
import * as document from "../../src/document/index.js";
import * as format from "../../src/format/index.js";
import * as main from "../../src/index.js";
import * as job from "../../src/job/index.js";
import * as locales from "../../src/locales/index.js";
import { expectFast } from "../fixtures/timing.js";

/** Whether `value`, and every object and array it holds, is frozen. */
const isDeepFrozen = (value: unknown, seen = new Set<unknown>()): boolean => {
  if (!value || typeof value !== "object" || seen.has(value)) return true;
  seen.add(value);
  return Object.isFrozen(value) && Object.values(value).every((item) => isDeepFrozen(item, seen));
};

/** The policy contract: `parseAtsPolicy` is pure, throws a typed error with structured issues, and accepts only policies that cannot fail at match time. */

const MINIMAL = {
  version: "ats-v2",
  rules: [
    {
      id: "test.parse.text",
      category: "parse",
      severity: "error",
      kind: "min-words",
      min: 5,
      weight: 10,
      passEvidence: "ok",
      failEvidence: "no",
      fix: "add words",
    },
  ],
  keywordMatch: {
    requiredWeight: 1,
    preferredWeight: 1,
    responsibilitiesWeight: 1,
    defaultWeight: 1,
    generalTermWeight: 0.5,
    sections: { required: "a", preferred: "b", responsibilities: "c", excluded: "d" },
    stopwords: [],
    synonyms: {},
    implies: {},
    phrases: [],
    buzzwords: [],
  },
  resumeParse: {
    sections: { experience: "a", education: "b", skills: "c", projects: "d", other: "e" },
    titleWords: ["engineer"],
    schoolWords: ["university"],
    degrees: { "4": "a", "5": "b", "6": "c", "7": "d", "8": "e" },
  },
};

const withRule = (rule: Record<string, unknown>) => ({ ...MINIMAL, rules: [rule] });

const presenceRule = {
  id: "test.presence",
  category: "structure",
  severity: "warning",
  kind: "presence",
  pattern: "\\bexperience\\b",
  flags: "i",
  weight: 5,
  passEvidence: "found",
  failEvidence: "missing",
  fix: "add it",
};

describe("parseAtsPolicy", () => {
  it("returns the parsed policy and throws nothing on a well-formed one", () => {
    const policy = parseAtsPolicy(MINIMAL);
    expect(policy.version).toBe("ats-v2");
    expect(policy.rules).toHaveLength(1);
  });

  /** Compiled patterns are cached against the policy object, so a parsed policy is frozen: a change throws instead of going unread. */
  it("returns a frozen policy, so a host that changes it throws", () => {
    const policy = parseAtsPolicy(MINIMAL);
    expect(isDeepFrozen(policy)).toBe(true);
    expect(() => {
      (policy as { version: string }).version = "changed";
    }).toThrow(TypeError);
    expect(() => policy.rules.push(policy.rules[0])).toThrow(TypeError);
    expect(() => {
      (policy.rules[0] as { weight: number }).weight = 1;
    }).toThrow(TypeError);
    expect(() => {
      (policy.resumeParse.months as Record<string, number>).jan = 2;
    }).toThrow(TypeError);
    // A copy is the host's own to change, and still reads as a policy.
    const copy = structuredClone(policy);
    copy.version = "changed";
    expect(parseAtsPolicy(copy).version).toBe("changed");
  });

  it("is pure — parsing twice yields equal, independent results", () => {
    const a = parseAtsPolicy(MINIMAL);
    const b = parseAtsPolicy(MINIMAL);
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });

  it("does not mutate the input", () => {
    const input = structuredClone(MINIMAL);
    const before = JSON.stringify(input);
    parseAtsPolicy(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it("throws AtsPolicyError, not a zod error, so the host never sees the dependency", () => {
    expect(() => parseAtsPolicy({})).toThrow(AtsPolicyError);
  });

  it("carries structured issues naming the offending field", () => {
    try {
      parseAtsPolicy({ ...MINIMAL, rules: [{ id: "broken" }] });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(AtsPolicyError);
      const issues = (error as AtsPolicyError).issues;
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0]).toHaveProperty("path");
      expect(issues[0]).toHaveProperty("message");
    }
  });

  /** Two weights of 1e308 summed to Infinity: the score read 100 while a category read 0. */
  it("refuses a weight above 1,000 with the path to it", () => {
    const pathsOf = (policy: unknown) => {
      try {
        parseAtsPolicy(policy);
        return [];
      } catch (error) {
        expect(error).toBeInstanceOf(AtsPolicyError);
        return (error as AtsPolicyError).issues.map((issue) => issue.path);
      }
    };
    // JSON reads 1e999 as Infinity.
    for (const weight of [1001, 1e308, JSON.parse("1e999") as number])
      expect(pathsOf(withRule({ ...presenceRule, weight })), String(weight)).toEqual([
        "rules.0.weight",
      ]);
    const bands = { ...presenceRule, kind: "bands", metric: "wordCount" };
    expect(pathsOf(withRule({ ...bands, bands: [{ upTo: null, weight: 1e308 }] }))).toEqual([
      "rules.0.bands.0.weight",
    ]);
    for (const field of [
      "requiredWeight",
      "preferredWeight",
      "responsibilitiesWeight",
      "defaultWeight",
    ])
      expect(
        pathsOf({ ...MINIMAL, keywordMatch: { ...MINIMAL.keywordMatch, [field]: 1e308 } }),
      ).toEqual([`keywordMatch.${field}`]);
    expect(pathsOf(withRule({ ...presenceRule, weight: 1000 }))).toEqual([]);
  });

  /** A policy can come from a host's JSON file: one nested past any real policy is refused, not a stack overflow, in the schema and in a key it drops. */
  it("refuses a policy nested 10,000 deep with AtsPolicyError", () => {
    for (const make of [(inner: unknown) => ({ a: inner }), (inner: unknown) => [inner]]) {
      let nested: unknown = "leaf";
      for (let depth = 0; depth < 10_000; depth += 1) nested = make(nested);
      for (const policy of [
        { ...MINIMAL, rules: nested },
        { ...MINIMAL, extra: nested },
      ]) {
        let thrown: unknown;
        try {
          parseAtsPolicy(policy);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(AtsPolicyError);
      }
    }
  });

  it("refuses a policy that contains itself with AtsPolicyError, at once", () => {
    // The loop is read last, after the whole of a full policy, on every lap.
    const policy: Record<string, unknown> = structuredClone(DEFAULT_POLICY);
    policy.extra = { list: [policy] };
    // Not after walking the loop to the depth limit, which took seconds.
    expectFast(() => expect(() => parseAtsPolicy(policy)).toThrow(AtsPolicyError), 200);
  });

  it("reads an object or a list a policy uses twice, which is no loop", () => {
    const words = ["engineer"];
    const shared = { a: "x" };
    const policy = parseAtsPolicy({
      ...MINIMAL,
      resumeParse: { ...MINIMAL.resumeParse, titleWords: words, schoolWords: words },
      extra: { a: shared, b: [shared, { c: shared }] },
    });
    expect(policy.resumeParse.titleWords).toEqual(["engineer"]);
    expect(policy.resumeParse.schoolWords).toEqual(["engineer"]);
  });

  it("reads a policy nested deep in a key it drops, as it always has", () => {
    let nested: unknown = "leaf";
    for (let depth = 0; depth < 1_000; depth += 1) nested = { a: nested };
    expect(parseAtsPolicy({ ...MINIMAL, extra: nested })).toEqual(parseAtsPolicy(MINIMAL));
  });

  it("keeps a key's last value when two keys normalise to one, and a __proto__ key as data", () => {
    const precomposed = "M\u00e4rz";
    const decomposed = "Ma\u0308rz";
    const policy = parseAtsPolicy({
      ...MINIMAL,
      ["__proto__"]: { polluted: true },
      resumeParse: {
        ...MINIMAL.resumeParse,
        months: { [precomposed]: 3, jan: 1, [decomposed]: 4 },
      },
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.entries(policy.resumeParse.months)).toEqual([
      [precomposed, 4],
      ["jan", 1],
    ]);
  });

  for (const bad of [null, undefined, "string", 42, [], true]) {
    it(`rejects ${JSON.stringify(bad) ?? "undefined"} without crashing`, () => {
      expect(() => parseAtsPolicy(bad)).toThrow(AtsPolicyError);
    });
  }

  /** A multi-word term in `implies` or `synonyms` but absent from `phrases` would never resolve. */
  it("rejects a multi-word term that could never match", () => {
    expect(() =>
      parseAtsPolicy({
        ...MINIMAL,
        keywordMatch: {
          ...MINIMAL.keywordMatch,
          implies: { terraform: ["infrastructure as code"] },
          phrases: [],
        },
      }),
    ).toThrow(AtsPolicyError);
  });

  it("rejects a synonym keyed by more than one word, which words are never looked up by", () => {
    const synonyms = (map: Record<string, string>) => ({
      ...MINIMAL,
      keywordMatch: {
        ...MINIMAL.keywordMatch,
        synonyms: map,
        phrases: ["amazon web services"],
      },
    });
    let error: unknown;
    try {
      parseAtsPolicy(synonyms({ "Amazon Web Services": "aws" }));
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AtsPolicyError);
    expect((error as AtsPolicyError).issues.map((issue) => issue.path)).toEqual([
      "keywordMatch.synonyms.amazon web services",
    ]);
    // The other way round is how a phrase and its abbreviation are one term.
    expect(() => parseAtsPolicy(synonyms({ aws: "amazon web services" }))).not.toThrow();
  });
});

/** A policy that validates must not be able to throw at match time. */
describe("regex fields are validated at parse time, not at match time", () => {
  it("rejects a pattern that does not compile", () => {
    expect(() => parseAtsPolicy(withRule({ ...presenceRule, pattern: "([unclosed" }))).toThrow(
      AtsPolicyError,
    );
  });

  it("rejects invalid regex flags", () => {
    expect(() => parseAtsPolicy(withRule({ ...presenceRule, flags: "iQ" }))).toThrow(
      AtsPolicyError,
    );
  });

  it("rejects a word list whose assembled alternation does not compile", () => {
    expect(() =>
      parseAtsPolicy({
        ...MINIMAL,
        resumeParse: { ...MINIMAL.resumeParse, titleWords: ["engineer", "c++"] },
      }),
    ).toThrow(AtsPolicyError);
  });

  it("rejects a malformed section heading pattern", () => {
    expect(() =>
      parseAtsPolicy({
        ...MINIMAL,
        resumeParse: {
          ...MINIMAL.resumeParse,
          sections: { ...MINIMAL.resumeParse.sections, experience: "(bad" },
        },
      }),
    ).toThrow(AtsPolicyError);
  });

  it("rejects a malformed degree pattern", () => {
    expect(() =>
      parseAtsPolicy({
        ...MINIMAL,
        resumeParse: {
          ...MINIMAL.resumeParse,
          degrees: { ...MINIMAL.resumeParse.degrees, "6": "(bad" },
        },
      }),
    ).toThrow(AtsPolicyError);
  });

  it("rejects a pattern without the capture group its value is read from", () => {
    const requirements = (field: string, pattern: string) => ({
      ...MINIMAL,
      keywordMatch: { ...MINIMAL.keywordMatch, requirements: { [field]: [pattern] } },
    });
    for (const [policy, path] of [
      [
        requirements("yearsPatterns", String.raw`\d+\+?\s+years`),
        "keywordMatch.requirements.yearsPatterns.0",
      ],
      [
        requirements("languagePatterns", String.raw`fluent\s+in\s+(?:\p{L}+)`),
        "keywordMatch.requirements.languagePatterns.0",
      ],
      [
        { ...MINIMAL, advice: { age: { experiencePatterns: [String.raw`\d+ years`] } } },
        "advice.age.experiencePatterns.0",
      ],
    ] as const) {
      let error: unknown;
      try {
        parseAtsPolicy(policy);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(AtsPolicyError);
      expect((error as AtsPolicyError).issues.map((issue) => issue.path)).toEqual([path]);
    }
    expect(() =>
      parseAtsPolicy(requirements("yearsPatterns", String.raw`(\d+)\+?\s+years`)),
    ).not.toThrow();
  });

  it("still accepts a legitimate pattern that merely looks exotic", () => {
    expect(() =>
      parseAtsPolicy(withRule({ ...presenceRule, pattern: "(?:\\b|^)(ph\\.?d\\.?)(?![a-z])" })),
    ).not.toThrow();
  });

  it("accepts a word list entry that is itself a small pattern", () => {
    expect(() =>
      parseAtsPolicy({
        ...MINIMAL,
        resumeParse: { ...MINIMAL.resumeParse, titleWords: ["sr\\.?", "engineer"] },
      }),
    ).not.toThrow();
  });
});

/** The shipped default has to work standalone. */
describe("DEFAULT_POLICY", () => {
  it("validates against the schema it is published beside", () => {
    expect(() => parseAtsPolicy(DEFAULT_POLICY)).not.toThrow();
  });

  it("is frozen, as every exported object is, so no host can change it under another", () => {
    expect(isDeepFrozen(DEFAULT_POLICY)).toBe(true);
    const modules = { main, document, format, job, locales, ai };
    const objects = Object.entries(modules).flatMap(([entry, module]) =>
      Object.entries(module)
        .filter(([, value]) => value && typeof value === "object")
        .map(([name, value]) => [`${entry}.${name}`, value] as const),
    );
    expect(objects.map(([name]) => name)).toEqual(
      expect.arrayContaining(["main.DEFAULT_POLICY", "locales.de", "ai.CONVERT_GROUNDING_SKIP"]),
    );
    for (const [name, value] of objects) expect(isDeepFrozen(value), name).toBe(true);
  });

  it("exercises every rule kind, so the default is a real demonstration", () => {
    const kinds = new Set(DEFAULT_POLICY.rules.map((rule) => rule.kind));
    expect(kinds).toEqual(
      new Set(["min-words", "presence", "position", "bands", "layout", "parsed", "section"]),
    );
  });

  it("scores a plainly good resume well and a plainly bad one badly", () => {
    const good = [
      "Jane Doe",
      "jane.doe@example.com | +1 415 555 0142",
      "",
      "Experience",
      "Staff Software Engineer, Acme Corp - Jan 2021 - Present",
      "- Led a migration to 30 microservices, reducing p99 latency by 42%.",
      "- Built CI/CD pipelines, cutting deploy time from 45 minutes to 6 minutes.",
      "- Designed a PostgreSQL sharding strategy that scaled throughput 8x.",
      "",
      "Senior Software Engineer, Globex - Mar 2018 - Dec 2020",
      "- Developed an analytics service processing 2.4M events per day.",
      "- Reduced infrastructure cost by 31% through rightsizing.",
      "",
      "Education",
      "B.S. Computer Science, University of California - 2014 - 2018",
      "",
      "Skills",
      "Go, TypeScript, PostgreSQL, Kubernetes, Terraform, Docker",
    ].join("\n");

    const report = check(good, DEFAULT_POLICY);
    expect(report.parsed.roles).toHaveLength(2);
    expect(report.parsed.email).toBe("jane.doe@example.com");
    expect(report.parsed.highestIsced).toBe(6);
    expect(report.readinessScore).toBeGreaterThan(70);

    const bad = check("hire me", DEFAULT_POLICY);
    expect(bad.readinessScore).toBeLessThan(50);
    expect(computeVerdict(bad)).toBe("weak");
  });

  it("credits an implied capability, so the implication map is wired up", () => {
    const report = check("jane@example.com\nSkills\nTerraform, PostgreSQL", DEFAULT_POLICY, {
      jobDescription: "Requirements\n- Infrastructure as code\n- Relational databases",
    });
    expect(report.missingKeywords).not.toContain("infrastructure as code");
    expect(report.jobMatchScore).toBeGreaterThan(0);
  });

  it("treats an alternation as one requirement", () => {
    const report = check("jane@example.com\nExperience\nShipped services in Go", DEFAULT_POLICY, {
      jobDescription: "Requirements\n- Go or Java",
    });
    expect(report.missingKeywords).not.toContain("java");
  });

  /** The tuned weights are private: the default must not match them. */
  it("does not ship the private calibration weights", () => {
    const km = DEFAULT_POLICY.keywordMatch;
    expect([
      km.requiredWeight,
      km.preferredWeight,
      km.responsibilitiesWeight,
      km.generalTermWeight,
    ]).not.toEqual([1.5, 0.75, 0.6, 0.35]);
  });
});

describe("the engine holds no state", () => {
  it("gives identical results for identical input", () => {
    const run = () =>
      JSON.stringify(
        check(
          "Jane Doe\njane@x.com\nExperience\nEngineer, Acme - Jan 2020 - Dec 2022",
          DEFAULT_POLICY,
          { jobDescription: "Requirements\nGo or Java" },
        ),
      );
    expect(run()).toBe(run());
  });

  it("does not mutate the resume or the policy", () => {
    const resume = { experience: [{ company: "Acme" }] };
    const resumeBefore = JSON.stringify(resume);
    const policyBefore = JSON.stringify(DEFAULT_POLICY);

    check(resume, DEFAULT_POLICY);

    expect(JSON.stringify(resume)).toBe(resumeBefore);
    expect(JSON.stringify(DEFAULT_POLICY)).toBe(policyBefore);
  });

  // N4 B31: a host's own unparsed policy, read with a day-first date order.
  it("neither freezes a host's own policy nor keeps reading it as it was", () => {
    const policy = structuredClone(DEFAULT_POLICY) as typeof DEFAULT_POLICY & { rules: unknown[] };
    const resume =
      "Jane Doe\njane@example.com\nExperience\nEngineer, Acme 15/07/2019 - 20/08/2022\n- Built the billing service";
    const ids = () => check(resume, policy).rules.map((rule) => rule.id);
    expect(ids()).toContain("ats-v2.contact.email");
    expect(Object.isFrozen(policy.rules)).toBe(false);
    policy.rules = policy.rules.filter((rule) => rule.id !== "ats-v2.contact.email");
    expect(ids()).not.toContain("ats-v2.contact.email");
  });

  it("survives degenerate input without throwing", () => {
    for (const resume of [null, undefined, 42, "", "   \n\n  ", {}, [], { a: { b: [] } }])
      expect(() => check(resume as AtsResumeInput, DEFAULT_POLICY)).not.toThrow();
  });

  /** `resume` is attacker-controlled: recursion over it must not overflow the stack. */
  it("caps recursion depth rather than overflowing the stack", () => {
    let nested: unknown = "leaf";
    for (let depth = 0; depth < 50_000; depth += 1) nested = { value: nested };
    expect(() => check(nested as AtsResumeInput, DEFAULT_POLICY)).not.toThrow();
  });
});

describe("the writing vocabulary and a rule's languages", () => {
  const writingRule = {
    id: "test.writing",
    category: "writing",
    severity: "info",
    kind: "bands",
    metric: "firstPersonLines",
    bands: [
      { upTo: 0, weight: 0 },
      { upTo: null, weight: 2 },
    ],
    passEvidence: "ok",
    failEvidence: "no",
    fix: "fix it",
  };

  it("gives a policy written before them English and the community word lists", () => {
    const policy = parseAtsPolicy(MINIMAL);
    expect(policy.text.language).toBe("en");
    expect(policy.writing).toEqual(DEFAULT_POLICY.writing);
    expect(policy.writing.bulletsPerRole).toEqual({ min: 2, max: 8 });
    expect(policy.writing.maxBulletWords).toBe(40);
  });

  it("accepts ISO 639 codes on a rule and refuses anything else", () => {
    const parsed = parseAtsPolicy(withRule({ ...writingRule, languages: ["en", "fil"] }));
    expect(parsed.rules[0]).toMatchObject({ languages: ["en", "fil"] });
    for (const languages of [[], ["EN"], ["english"]])
      expect(() => parseAtsPolicy(withRule({ ...writingRule, languages }))).toThrow(AtsPolicyError);
  });

  it("refuses another language with neither a script nor ten words to tell it by", () => {
    for (const other of [{ script: "Klingon" }, { detectionWords: ["y", "con", "para"] }, {}])
      expect(() => parseAtsPolicy({ ...MINIMAL, text: { otherLanguages: [other] } })).toThrow(
        AtsPolicyError,
      );
    expect(
      parseAtsPolicy({ ...MINIMAL, text: { otherLanguages: [] } }).text.otherLanguages,
    ).toEqual([]);
  });

  it("refuses a bullet range upside down and a word list that does not compile", () => {
    expect(() =>
      parseAtsPolicy({ ...MINIMAL, writing: { bulletsPerRole: { min: 9, max: 3 } } }),
    ).toThrow(AtsPolicyError);
    expect(() => parseAtsPolicy({ ...MINIMAL, writing: { weakOpeners: ["(unclosed"] } })).toThrow(
      AtsPolicyError,
    );
  });
});
