import { describe, expect, it } from "vitest";
import { toJSONSchema } from "zod/v4/core";

import { toStrictJsonSchema } from "../../src/ai/schema.js";
import { AtsAiError, createAtsAi } from "../../src/ai/index.js";
import { insightsSchema } from "../../src/ai/tasks/analyze.js";
import { convertedResumeSchema } from "../../src/ai/tasks/convertResume.js";
import { repairedResumeSchema } from "../../src/ai/tasks/repairParse.js";
import { scriptedProvider } from "../../src/ai/testing/index.js";
import { resumeDocumentSchema } from "../../src/document/schema.js";
import {
  ATS_DOCUMENT_FORMAT,
  AtsInputError,
  AtsPolicyError,
  DEFAULT_POLICY,
  check,
  parseAtsPolicy,
  prepareResume,
} from "../../src/index.js";
import {
  atsLanguagePackJsonSchema,
  atsRegionPackJsonSchema,
  BUILT_IN_LOCALES,
  withLocales,
} from "../../src/locales/index.js";
import { languagePackSchema, regionPackSchema } from "../../src/locales/schema.js";
import { atsEngineSchema } from "../../src/policy/schema.js";

/**
 * What the schemas do, recorded so a change of validation library (or of its version) is seen
 * to change nothing: parsed output with every default, the issues (path, message and the raw
 * issue's other fields) an invalid policy, locale pack, document or model reply raises, and the
 * JSON Schemas generated from them. The snapshots are the behaviour; a diff in one is a change
 * users would see.
 */

const SNAPSHOTS = "./__snapshots__/zod-equivalence";

/** JSON that keeps what plain JSON drops: an explicit `undefined`, and non-finite numbers. */
function serialize(value: unknown): string {
  return `${JSON.stringify(
    value,
    (_key, item: unknown) => {
      if (item === undefined) return "<undefined>";
      if (typeof item === "number" && !Number.isFinite(item)) return `<${item}>`;
      if (item instanceof RegExp) return `<RegExp ${item.toString()}>`;
      return item;
    },
    2,
  )}\n`;
}

const snap = (name: string, value: unknown) =>
  expect(serialize(value)).toMatchFileSnapshot(`${SNAPSHOTS}/${name}.json`);

/** A raw zod issue without its human message (checked separately through the public error). */
function shape(issue: unknown): unknown {
  if (Array.isArray(issue)) return issue.map(shape);
  if (!issue || typeof issue !== "object") return issue;
  return Object.fromEntries(
    Object.entries(issue)
      .filter(([key]) => key !== "message")
      .map(([key, item]) => [key, shape(item)]),
  );
}

/** Every way the engine reports a policy: the public error and the raw issues behind it. */
function policyOutcome(input: unknown) {
  let error: unknown;
  try {
    parseAtsPolicy(input);
  } catch (caught) {
    error = caught;
  }
  const raw = atsEngineSchema.safeParse(input);
  return {
    error:
      error instanceof AtsPolicyError
        ? { name: error.name, message: error.message, issues: error.issues }
        : error === undefined
          ? null
          : { unexpected: String(error) },
    raw: raw.success ? "success" : shape(raw.error.issues),
  };
}

function localesOutcome(packs: Parameters<typeof withLocales>[1]) {
  try {
    withLocales(DEFAULT_POLICY, packs);
    return { error: null };
  } catch (error) {
    if (!(error instanceof AtsPolicyError)) return { unexpected: String(error) };
    return { error: { name: error.name, message: error.message, issues: error.issues } };
  }
}

const clone = <T>(value: T): T => structuredClone(value);
type Json = Record<string, unknown>;
const POLICY = DEFAULT_POLICY as unknown as Json;
const rule = (kind: string) => clone(DEFAULT_POLICY.rules.find((r) => r.kind === kind)) as Json;
/** The default policy with one rule replaced by `replacement`. */
const withRule = (replacement: Json) => ({ ...POLICY, rules: [replacement] });
/** The default policy with `section.key` set to `value` (an `undefined` deletes it). */
function withField(section: string, key: string, value: unknown) {
  const next = clone(POLICY) as Record<string, Json>;
  if (value === undefined) delete next[section]![key];
  else next[section]![key] = value;
  return next;
}
const withAdvice = (advice: unknown) => ({ ...POLICY, advice });

/**
 * The fewest fields a policy can have: everything with a default or a prefault left out, down to
 * whole sections (`text`, `writing`, `advice`, `locales`).
 */
const MINIMAL_POLICY = {
  version: "minimal",
  rules: [
    {
      id: "r.presence",
      category: "c",
      severity: "info",
      passEvidence: "p",
      failEvidence: "f",
      fix: "x",
      kind: "presence",
      pattern: "a",
      weight: 1,
    },
    {
      id: "r.bands",
      category: "c",
      severity: "warning",
      passEvidence: "p",
      failEvidence: "f",
      fix: "x",
      kind: "bands",
      metric: "wordCount",
      bands: [{ upTo: null, weight: 1 }],
    },
  ],
  keywordMatch: {
    requiredWeight: 2,
    preferredWeight: 1,
    responsibilitiesWeight: 1,
    defaultWeight: 1,
    generalTermWeight: 0.5,
    sections: { required: "req", preferred: "pref", responsibilities: "resp", excluded: "exc" },
    stopwords: ["The"],
    synonyms: { JS: "JavaScript" },
    implies: {},
    phrases: [],
    buzzwords: [],
  },
  resumeParse: {
    sections: {
      experience: "experience",
      education: "education",
      skills: "skills",
      projects: "projects",
      other: "other",
    },
    titleWords: ["engineer"],
    schoolWords: ["university"],
    degrees: { "6": "bachelor" },
  },
};

describe("zod equivalence: parsed policies", () => {
  it("parses the default policy to the same object", async () => {
    await snap("default-policy", parseAtsPolicy(DEFAULT_POLICY));
  });

  it("parses the default policy with the built-in locales attached", async () => {
    await snap("default-policy-with-locales", withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES));
  });

  it("fills every default and prefault of a minimal policy", async () => {
    await snap("minimal-policy", parseAtsPolicy(MINIMAL_POLICY));
  });

  it("fills defaults the same way when sections are given empty or partly", async () => {
    const empty = parseAtsPolicy({
      ...MINIMAL_POLICY,
      text: {},
      writing: {},
      advice: { file: {}, age: {}, messages: {} },
      locales: {},
      keywordMatch: {
        ...MINIMAL_POLICY.keywordMatch,
        proseNames: {},
        requirements: {},
      },
      resumeParse: { ...MINIMAL_POLICY.resumeParse, credentialWords: {} },
    });
    expect(empty).toEqual(parseAtsPolicy(MINIMAL_POLICY));

    const partial = parseAtsPolicy({
      ...MINIMAL_POLICY,
      text: { language: "de", actionVerbAnywhere: true },
      writing: { maxBulletWords: 12, bulletsPerRole: { min: 1, max: 3 } },
      advice: {
        file: { maxBytes: 1000, suggestedName: "{name}{ext}" },
        age: { graduationYears: 10, experienceYears: 25 },
        targets: {
          acme: { name: "Acme", notes: [{ id: "n1", message: "m", source: "https://a.b" }] },
        },
        messages: { fileName: { message: "m", fix: "f" }, experienceHistory: "h" },
      },
      locales: { languages: [] },
      keywordMatch: {
        ...MINIMAL_POLICY.keywordMatch,
        softSkillWeight: 0.1,
        softSkills: ["Team Work"],
        phrases: ["team work"],
        proseNames: { enabled: false },
        requirements: { equivalence: ["or equal"] },
        numberWords: { One: 1 },
        qualifiers: [{ words: ["Lead"] }],
        stemming: [{ suffix: "s", minLength: 2, replacement: "" }],
      },
      resumeParse: {
        ...MINIMAL_POLICY.resumeParse,
        credentialWords: { issued: ["got"] },
        dateOrder: "DMY",
        phoneRegions: ["DE"],
        languageLevels: { fluent: "C1" },
        months: { jan: 1 },
        seasons: { spring: [3, 5] },
        openEnded: ["now"],
        sections: { ...MINIMAL_POLICY.resumeParse.sections, certifications: "certs" },
      },
      rules: [
        {
          ...MINIMAL_POLICY.rules[0],
          flags: "i",
          invert: true,
          scope: "line",
          penalty: true,
          languages: ["en", "deu"],
        },
        MINIMAL_POLICY.rules[1],
      ],
    });
    await snap("partial-policy", partial);
  });

  it("reads legacy degree names as ISCED levels", async () => {
    await snap(
      "legacy-degrees",
      parseAtsPolicy({
        ...MINIMAL_POLICY,
        resumeParse: {
          ...MINIMAL_POLICY.resumeParse,
          degrees: {
            diploma: "dip",
            associate: "assoc",
            bachelor: "bach",
            master: "mast",
            doctorate: "doc",
          },
        },
      }).resumeParse.degrees,
    );
  });

  it("strips unknown keys", async () => {
    await snap(
      "unknown-keys",
      parseAtsPolicy({
        ...MINIMAL_POLICY,
        extra: 1,
        text: { unknown: true },
        rules: [{ ...MINIMAL_POLICY.rules[0], extra: "x" }],
      }),
    );
  });

  it("hands each parse its own copy of a default, shallowly", async () => {
    const a = parseAtsPolicy(MINIMAL_POLICY);
    const b = parseAtsPolicy(MINIMAL_POLICY);
    await snap("default-identity", {
      openEnded: a.resumeParse.openEnded === b.resumeParse.openEnded,
      months: a.resumeParse.months === b.resumeParse.months,
      stemming: a.keywordMatch.stemming === b.keywordMatch.stemming,
      stemmingItem: a.keywordMatch.stemming[0] === b.keywordMatch.stemming[0],
      qualifiersItem: a.keywordMatch.qualifiers[0] === b.keywordMatch.qualifiers[0],
      bulletsPerRole: a.writing.bulletsPerRole === b.writing.bulletsPerRole,
      targets: a.advice.targets === b.advice.targets,
      targetsItem: a.advice.targets.greenhouse === b.advice.targets.greenhouse,
      messagesFileName: a.advice.messages.fileName === b.advice.messages.fileName,
      seasonsItem: a.resumeParse.seasons.spring === b.resumeParse.seasons.spring,
      text: a.text === b.text,
      inputUntouched: JSON.stringify(MINIMAL_POLICY).length,
    });
  });
});

/** Invalid policies, one failure each where possible; every refinement and check is covered. */
const INVALID_POLICIES: Array<[string, unknown]> = [
  ["not an object", "policy"],
  ["null", null],
  ["empty object", {}],
  ["version empty", { ...POLICY, version: "" }],
  ["version a number", { ...POLICY, version: 2 }],
  ["rules empty", { ...POLICY, rules: [] }],
  ["rules not an array", { ...POLICY, rules: {} }],
  ["rule of an unknown kind", withRule({ ...rule("presence"), kind: "regex" })],
  ["rule with no kind", withRule({ ...rule("presence"), kind: undefined })],
  ["duplicate rule ids", { ...POLICY, rules: [rule("presence"), rule("presence")] }],
  ["rule id empty", withRule({ ...rule("presence"), id: "" })],
  ["severity unknown", withRule({ ...rule("presence"), severity: "fatal" })],
  ["penalty not a boolean", withRule({ ...rule("presence"), penalty: "yes" })],
  ["languages not ISO", withRule({ ...rule("presence"), languages: ["EN"] })],
  ["languages empty", withRule({ ...rule("presence"), languages: [] })],
  ["pattern empty", withRule({ ...rule("presence"), pattern: "" })],
  ["pattern malformed", withRule({ ...rule("presence"), pattern: "(unclosed" })],
  ["pattern escape invalid in Unicode mode", withRule({ ...rule("presence"), pattern: "a\\-b" })],
  ["flags unknown", withRule({ ...rule("presence"), flags: "q" })],
  ["flags repeated", withRule({ ...rule("presence"), flags: "ii" })],
  ["flags sticky", withRule({ ...rule("presence"), flags: "y" })],
  ["pattern invalid with its flags", withRule({ ...rule("presence"), pattern: "[(]", flags: "v" })],
  ["scope unknown", withRule({ ...rule("presence"), scope: "page" })],
  ["weight negative", withRule({ ...rule("presence"), weight: -1 })],
  ["weight a string", withRule({ ...rule("presence"), weight: "1" })],
  ["min-words min zero", withRule({ ...rule("min-words"), min: 0 })],
  ["min-words min fractional", withRule({ ...rule("min-words"), min: 1.5 })],
  ["min-words min unsafe", withRule({ ...rule("min-words"), min: 2 ** 60 })],
  ["min-words min NaN", withRule({ ...rule("min-words"), min: Number.NaN })],
  ["min-words min Infinity", withRule({ ...rule("min-words"), min: Number.POSITIVE_INFINITY })],
  ["position window above 1", withRule({ ...rule("position"), windowFraction: 2 })],
  ["position window below 0", withRule({ ...rule("position"), windowFraction: -0.1 })],
  ["position emailPattern malformed", withRule({ ...rule("position"), emailPattern: "[" })],
  ["bands empty", withRule({ ...rule("bands"), bands: [] })],
  [
    "bands not ascending",
    withRule({
      ...rule("bands"),
      bands: [
        { upTo: 500, weight: 0 },
        { upTo: 100, weight: 1 },
        { upTo: null, weight: 2 },
      ],
    }),
  ],
  [
    "bands null before the last",
    withRule({
      ...rule("bands"),
      bands: [
        { upTo: null, weight: 0 },
        { upTo: 100, weight: 1 },
      ],
    }),
  ],
  [
    "band weight negative and evidence empty",
    withRule({ ...rule("bands"), bands: [{ upTo: null, weight: -1, failEvidence: "", fix: "" }] }),
  ],
  ["band upTo missing", withRule({ ...rule("bands"), bands: [{ weight: 1 }] })],
  ["bands metric unknown", withRule({ ...rule("bands"), metric: "words" })],
  ["bands pattern malformed", withRule({ ...rule("bands"), pattern: "*" })],
  ["layout appliesWhen wrong", withRule({ ...rule("layout"), appliesWhen: "text" })],
  ["layout metric unknown", withRule({ ...rule("layout"), metric: "fonts" })],
  ["parsed metric unknown", withRule({ ...rule("parsed"), metric: "names" })],
  ["section unknown", withRule({ ...rule("section"), section: "hobbies" })],
  ["keywordMatch missing", { ...POLICY, keywordMatch: undefined }],
  ["requiredWeight zero", withField("keywordMatch", "requiredWeight", 0)],
  ["generalTermWeight above 1", withField("keywordMatch", "generalTermWeight", 1.5)],
  ["softSkillWeight negative", withField("keywordMatch", "softSkillWeight", -0.5)],
  ["softSkills with an empty term", withField("keywordMatch", "softSkills", [""])],
  ["job section malformed", withField("keywordMatch", "sections", { required: "(" })],
  ["alternationWords empty", withField("keywordMatch", "alternationWords", [])],
  ["alternationWords with an empty word", withField("keywordMatch", "alternationWords", [""])],
  ["alternationWords not assembling", withField("keywordMatch", "alternationWords", ["c++"])],
  [
    "stemming rule malformed",
    withField("keywordMatch", "stemming", [{ suffix: "", minLength: -1, replacement: 1 }]),
  ],
  ["proseNames minListLines zero", withField("keywordMatch", "proseNames", { minListLines: 0 })],
  [
    "requirements patterns malformed",
    withField("keywordMatch", "requirements", {
      yearsPatterns: ["("],
      languageNames: { "": "" },
    }),
  ],
  [
    "numberWords not positive integers",
    withField("keywordMatch", "numberWords", { one: 0, two: 2.5 }),
  ],
  ["qualifiers with no words", withField("keywordMatch", "qualifiers", [{ words: [] }])],
  ["ignorePatterns malformed", withField("keywordMatch", "ignorePatterns", ["a{2,1}"])],
  ["synonyms not a record", withField("keywordMatch", "synonyms", ["a"])],
  ["implies values not arrays", withField("keywordMatch", "implies", { a: "b" })],
  [
    "multi-word term missing from phrases",
    {
      ...POLICY,
      keywordMatch: {
        ...(POLICY.keywordMatch as Json),
        implies: { "event sourcing": ["domain driven design"] },
        synonyms: { k8s: "container orchestration" },
      },
    },
  ],
  ["resume sections missing a heading", withField("resumeParse", "sections", { experience: "x" })],
  ["languageLevels unknown level", withField("resumeParse", "languageLevels", { fluent: "D1" })],
  ["languageLevels not assembling", withField("resumeParse", "languageLevels", { "a)": "C1" })],
  [
    "credentialWords not assembling",
    withField("resumeParse", "credentialWords", { issued: ["("], id: [] }),
  ],
  ["months out of range", withField("resumeParse", "months", { jan: 0, dec: 13, feb: "2" })],
  ["seasons malformed", withField("resumeParse", "seasons", { spring: [3], fall: [9, 11, 12] })],
  ["openEnded empty", withField("resumeParse", "openEnded", [])],
  ["dateOrder unknown", withField("resumeParse", "dateOrder", "DYM")],
  ["phoneRegions lower case", withField("resumeParse", "phoneRegions", ["us"])],
  ["titleWords missing", withField("resumeParse", "titleWords", undefined)],
  ["degrees naming no level", withField("resumeParse", "degrees", {})],
  ["degrees malformed", withField("resumeParse", "degrees", { "6": "(" })],
  ["degrees legacy incomplete", withField("resumeParse", "degrees", { bachelor: "b" })],
  ["degrees not an object", withField("resumeParse", "degrees", "bachelor")],
  ["text language not ISO", { ...POLICY, text: { language: "english" } }],
  ["text section null", { ...POLICY, text: null }],
  ["text injectionPhrases not assembling", { ...POLICY, text: { injectionPhrases: ["(?<"] } }],
  ["writing maxBulletWords zero", { ...POLICY, writing: { maxBulletWords: 0 } }],
  [
    "writing bullets range inverted",
    { ...POLICY, writing: { bulletsPerRole: { min: 5, max: 2 } } },
  ],
  ["writing repeatedOpenerRun 1", { ...POLICY, writing: { repeatedOpenerRun: 1 } }],
  ["advice maxBytes zero", withAdvice({ file: { maxBytes: 0 } })],
  ["advice genericNames empty", withAdvice({ file: { genericNames: [] } })],
  ["advice experiencePatterns malformed", withAdvice({ age: { experiencePatterns: ["(?<x"] } })],
  ["advice graduationYears fractional", withAdvice({ age: { graduationYears: 1.5 } })],
  [
    "advice target id upper case",
    withAdvice({
      targets: { Acme: { name: "A", notes: [{ id: "n", message: "m", source: "https://x" }] } },
    }),
  ],
  [
    "advice note malformed",
    withAdvice({
      targets: { acme: { name: "", notes: [{ id: "1n", message: "", source: "http://x" }] } },
    }),
  ],
  ["advice target with no notes", withAdvice({ targets: { acme: { name: "A", notes: [] } } })],
  [
    "advice message templates empty",
    withAdvice({
      messages: { fileName: { message: "", evidence: "", fix: "" }, fileNameDraft: "" },
    }),
  ],
  ["locales languages not an array", { ...POLICY, locales: { languages: {} } }],
];

describe("zod equivalence: invalid policies", () => {
  it("has a wide battery of cases", () => {
    expect(INVALID_POLICIES.length).toBeGreaterThanOrEqual(25);
  });

  it.each(INVALID_POLICIES)("reports %s", async (name, input) => {
    const outcome = policyOutcome(input);
    expect(outcome.error).not.toBeNull();
    await snap(`invalid-policy/${name.replaceAll(" ", "-")}`, outcome);
  });
});

const LANGUAGE_PACK = {
  id: "xx",
  name: "Example",
  status: "community",
  script: "Latin",
  months: { janvier: 1 },
};
const REGION_PACK = {
  id: "XX",
  name: "Example",
  status: "community",
  phoneCountry: "FR",
  dateOrder: "DMY",
};

const INVALID_PACKS: Array<[string, Parameters<typeof withLocales>[1]]> = [
  ["language id not ISO", { languages: [{ ...LANGUAGE_PACK, id: "Xx" }] as never }],
  ["language status unknown", { languages: [{ ...LANGUAGE_PACK, status: "draft" }] as never }],
  [
    "language with neither script nor detection words",
    { languages: [{ ...LANGUAGE_PACK, script: undefined, detectionWords: ["a", "b"] }] as never },
  ],
  ["language script unknown", { languages: [{ ...LANGUAGE_PACK, script: "Klingon" }] as never }],
  [
    "language defaultRegion lower case",
    { languages: [{ ...LANGUAGE_PACK, defaultRegion: "fr" }] as never },
  ],
  [
    "language vocabulary malformed",
    {
      languages: [
        {
          ...LANGUAGE_PACK,
          sections: { experience: "(" },
          titleWords: [],
          months: { janvier: 13 },
          seasons: { été: [6] },
          stopwords: [""],
          requirements: { clearance: ["("] },
          jobSections: { required: "" },
          degrees: { "9": "x", "6": "(" },
          languageLevels: { fluide: "Z9" },
          credentialWords: { issued: [] },
          actionVerbAnywhere: "yes",
        },
      ] as never,
    },
  ],
  ["region id lower case", { regions: [{ ...REGION_PACK, id: "xx" }] as never }],
  [
    "region phone country unsupported",
    { regions: [{ ...REGION_PACK, phoneCountry: "ZZ" }] as never },
  ],
  ["region dateOrder missing", { regions: [{ ...REGION_PACK, dateOrder: undefined }] as never }],
  [
    "region rule adjustments malformed",
    { regions: [{ ...REGION_PACK, rules: { "": { weight: -1, severity: "fatal" } } }] as never },
  ],
  [
    "region ageAdvice malformed",
    { regions: [{ ...REGION_PACK, ageAdvice: { graduationYears: 0 } }] as never },
  ],
  [
    "packs that do not combine",
    {
      languages: [{ ...LANGUAGE_PACK, sections: { experience: "(?<experience>exp)" } }] as never,
      regions: [{ ...REGION_PACK, sections: { experience: "(?<experience>erf)" } }] as never,
    },
  ],
];

describe("zod equivalence: locale packs", () => {
  it("publishes the same JSON Schemas", async () => {
    await snap("locales-json-schema-language", atsLanguagePackJsonSchema);
    await snap("locales-json-schema-region", atsRegionPackJsonSchema);
  });

  it("parses valid packs to the same objects", async () => {
    await snap("locales-valid-packs", {
      language: languagePackSchema.parse(LANGUAGE_PACK),
      languageWithWords: languagePackSchema.parse({
        ...LANGUAGE_PACK,
        script: undefined,
        detectionWords: "a b c d e f g h i j".split(" "),
        stopwords: ["Le"],
        softSkills: ["Esprit D'équipe"],
      }),
      region: regionPackSchema.parse(REGION_PACK),
      attached: withLocales(MINIMAL_POLICY, {
        languages: [LANGUAGE_PACK as never],
        regions: [REGION_PACK as never],
      }).locales,
    });
  });

  it.each(INVALID_PACKS)("reports %s", async (name, packs) => {
    const outcome = localesOutcome(packs);
    expect(outcome.error).not.toBeNull();
    await snap(`invalid-pack/${name.replaceAll(" ", "-")}`, {
      ...outcome,
      raw: [
        ...(packs.languages ?? []).map((pack) => languagePackSchema.safeParse(pack)),
        ...(packs.regions ?? []).map((pack) => regionPackSchema.safeParse(pack)),
      ].map((result) => (result.success ? "success" : shape(result.error.issues))),
    });
  });
});

describe("zod equivalence: JSON Schemas", () => {
  it("generates the same strict schemas for the AI tasks", async () => {
    await snap("ai-json-schemas", {
      analyze: toStrictJsonSchema(insightsSchema),
      convertResume: toStrictJsonSchema(convertedResumeSchema),
      repairParse: toStrictJsonSchema(repairedResumeSchema),
    });
  });

  it("generates the same JSON Schema for the policy, input and output", async () => {
    await snap("policy-json-schema", {
      input: toJSONSchema(atsEngineSchema, { io: "input", unrepresentable: "any" }),
      output: toJSONSchema(atsEngineSchema, { io: "output", unrepresentable: "any" }),
      document: toJSONSchema(resumeDocumentSchema, { io: "input", unrepresentable: "any" }),
    });
  });
});

const RESUME_TEXT = [
  "Jane Doe",
  "jane@example.com | +1 415 555 0142",
  "Experience",
  "Senior Engineer at Acme Corporation",
  "Jan 2020 - Present",
  "- Built the payments platform",
  "Education",
  "BSc Computer Science, State University, 2016",
  "Skills",
  "TypeScript, Go",
].join("\n");

/** Each task once with `reply`, no retries: its result or its error, and the request schema. */
async function runTasks(reply: unknown) {
  const text = typeof reply === "string" ? reply : JSON.stringify(reply);
  const report = check(RESUME_TEXT, DEFAULT_POLICY, { now: new Date("2026-09-30T00:00:00Z") });
  const outcomes: Record<string, unknown> = {};
  const run = async (
    name: string,
    call: (ai: ReturnType<typeof createAtsAi>) => Promise<unknown>,
  ) => {
    const provider = scriptedProvider(text);
    const route = { model: "m", maxTokens: 100, retries: 0 };
    const ai = createAtsAi({
      provider,
      routes: { analyze: route, repairParse: route, convertResume: route },
    });
    try {
      const outcome = (await call(ai)) as { result: unknown; rejected: unknown };
      outcomes[name] = { result: outcome.result, rejected: outcome.rejected };
    } catch (error) {
      outcomes[name] =
        error instanceof AtsAiError
          ? {
              error: { name: error.name, code: error.code, message: error.message },
              cause: shape((error.cause as { issues?: unknown } | undefined)?.issues),
            }
          : { unexpected: String(error) };
    }
    return provider.calls[0]?.output;
  };
  const requests = {
    analyze: await run("analyze", (ai) => ai.analyze({ resumeText: RESUME_TEXT, report })),
    repairParse: await run("repairParse", (ai) =>
      ai.repairParse({ resumeText: RESUME_TEXT, report, now: new Date("2026-09-30T00:00:00Z") }),
    ),
    convertResume: await run("convertResume", (ai) =>
      ai.convertResume({ resumeText: RESUME_TEXT }),
    ),
  };
  return { outcomes, requests };
}

const AI_REPLIES: Array<[string, unknown]> = [
  ["empty object", {}],
  [
    "valid for every task",
    {
      explanation: "Solid.",
      missingEvidence: ["metrics"],
      keywordOpportunities: null,
      name: " Jane Doe ",
      email: "jane@example.com",
      roles: [
        {
          title: "Senior Engineer",
          employer: "Acme Corporation",
          start: { year: 2020, month: 1 },
          end: null,
          current: true,
        },
      ],
      education: [{ school: "State University", credential: "BSc", end: { year: 2016 } }],
      skills: ["TypeScript", null],
      basics: { fullName: "Jane Doe", role: null },
      experience: [{ company: "Acme Corporation", role: "Senior Engineer", highlights: null }],
    },
  ],
  [
    "wrong types",
    { explanation: 1, roles: "x", basics: [], skills: [1], education: [{ end: "2016" }] },
  ],
  [
    "over limits",
    {
      explanation: "x".repeat(4_001),
      missingEvidence: Array(13).fill("m"),
      roles: Array(31).fill({}),
      name: "n".repeat(201),
      summary: "s".repeat(4_001),
      links: [{ label: "l".repeat(101) }],
    },
  ],
  [
    "dates out of range",
    { roles: [{ start: { year: 1899, month: 0 }, end: { year: 2020.5, month: 13 } }] },
  ],
  ["a JSON array", []],
  ["null", null],
];

describe("zod equivalence: AI replies", () => {
  it.each(AI_REPLIES)("reads %s", async (name, reply) => {
    await snap(`ai-reply/${name.replaceAll(" ", "-")}`, await runTasks(reply));
  });

  it("parses replies directly to the same values and issues", async () => {
    const results: Record<string, unknown> = {};
    for (const [name, reply] of AI_REPLIES)
      results[name] = Object.fromEntries(
        Object.entries({ insightsSchema, convertedResumeSchema, repairedResumeSchema }).map(
          ([schemaName, schema]) => {
            const result = schema.safeParse(reply);
            return [
              schemaName,
              result.success ? { data: result.data } : shape(result.error.issues),
            ];
          },
        ),
      );
    await snap("ai-direct", results);
  });
});

const DOCUMENT = {
  format: ATS_DOCUMENT_FORMAT,
  basics: {
    name: "Jane Doe",
    headline: "Senior Engineer",
    email: "jane@example.com",
    phone: "+1 415 555 0142",
    location: "Ｂｏｓｔｏｎ",
    links: ["https://example.com/jane"],
    extra: "dropped",
  },
  sections: [
    { kind: "summary", title: "Summary", text: "Builds payment systems." },
    {
      kind: "experience",
      title: "Experience",
      items: [
        {
          title: "Senior Engineer",
          employer: "Acme",
          start: "２０２０-01",
          current: true,
          summary: "s".repeat(6_000),
          highlights: ["Built the platform"],
        },
      ],
    },
    {
      kind: "education",
      title: "Education",
      items: [{ school: "State University", credential: "BSc", end: "2016" }],
    },
    {
      kind: "projects",
      title: "Projects",
      items: [{ name: "Ledger", url: "https://x", skills: ["Go"], highlights: [] }],
    },
    { kind: "skills", title: "Skills", items: [{ name: "Languages", keywords: ["Go", "TS"] }] },
    {
      kind: "certifications",
      title: "Certifications",
      items: [{ name: "CKA", issuer: "CNCF", date: "2021", expires: "2024" }],
    },
    { kind: "languages", title: "Languages", items: [{ language: "German", level: "C1" }] },
    {
      kind: "other",
      title: "Awards",
      items: [{ heading: "Award", lines: ["Best"] }, { lines: [] }],
    },
  ],
};

const INVALID_DOCUMENTS: Array<[string, unknown]> = [
  ["basics missing", { format: ATS_DOCUMENT_FORMAT, sections: [] }],
  ["sections not an array", { ...DOCUMENT, sections: {} }],
  ["section kind unknown", { ...DOCUMENT, sections: [{ kind: "hobbies", title: "H" }] }],
  ["section kind missing", { ...DOCUMENT, sections: [{ title: "H" }] }],
  ["name not a string", { ...DOCUMENT, basics: { name: 42 } }],
  ["links too many", { ...DOCUMENT, basics: { name: "J", links: Array(51).fill("x") } }],
  [
    "items too many",
    {
      ...DOCUMENT,
      sections: [{ kind: "languages", title: "L", items: Array(201).fill({ language: "x" }) }],
    },
  ],
  [
    "sections too many",
    { ...DOCUMENT, sections: Array(41).fill({ kind: "summary", title: "S", text: "t" }) },
  ],
  [
    "role fields wrong",
    {
      ...DOCUMENT,
      sections: [
        {
          kind: "experience",
          title: "E",
          items: [{ title: null, employer: "A", current: "yes", highlights: "x", start: 2020 }],
        },
      ],
    },
  ],
  [
    "skills keywords too many",
    {
      ...DOCUMENT,
      sections: [{ kind: "skills", title: "S", items: [{ keywords: Array(201).fill("k") }] }],
    },
  ],
];

describe("zod equivalence: documents", () => {
  it("reads a valid document to the same text and structure", async () => {
    const prepared = prepareResume(DOCUMENT as never);
    await snap("document-valid", {
      text: prepared.text,
      document: prepared.document,
      direct: resumeDocumentSchema.parse(DOCUMENT),
    });
  });

  it.each(INVALID_DOCUMENTS)("reports %s", async (name, input) => {
    let error: unknown;
    try {
      prepareResume(input as never);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AtsInputError);
    const raw = resumeDocumentSchema.safeParse(input);
    await snap(`invalid-document/${name.replaceAll(" ", "-")}`, {
      error: {
        name: (error as AtsInputError).name,
        message: (error as AtsInputError).message,
        issues: (error as AtsInputError).issues,
      },
      raw: raw.success ? "success" : shape(raw.error.issues),
    });
  });
});
