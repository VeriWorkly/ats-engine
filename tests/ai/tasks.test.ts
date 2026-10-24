import { describe, expect, it } from "vitest";

import { convertedToDocument, createAtsAi, groundedText } from "../../src/ai/index.js";
import { createRedaction } from "../../src/ai/redact.js";
import { scriptedProvider } from "../../src/ai/testing/index.js";
import { DEFAULT_POLICY } from "../../src/policy/default.js";
import { check } from "../../src/scoring/engine.js";
import type { AtsReport } from "../../src/types.js";
import { expectFast } from "../fixtures/timing.js";

const route = { model: "m", maxTokens: 100 };
const routes = { analyze: route, repairParse: route, convertResume: route };

const RESUME = [
  "Jane Doe",
  "jane.doe@example.com | (415) 555-0199 | linkedin.com/in/janedoe",
  "",
  "Experience",
  "Senior Engineer, Acme Corporation",
  "Jan 2020 - Present",
  "- Built payment systems in TypeScript, cutting failures 40%.",
].join("\n");
const JOB = "We need TypeScript, Kubernetes and payments experience.";

function report(): AtsReport {
  return check(RESUME, DEFAULT_POLICY, { jobDescription: JOB });
}

const insights = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    explanation: "Your resume reads well.",
    missingEvidence: [],
    keywordOpportunities: [],
    recommendedImprovements: [],
    priorityOrder: [],
    ...overrides,
  });

function userMessage(provider: ReturnType<typeof scriptedProvider>) {
  return JSON.parse(provider.calls[0]!.messages[0]!.content) as {
    deterministicReport: AtsReport;
    resume: string;
    jobDescription: string | null;
  };
}

describe("analyze", () => {
  it("withholds contact details from the model and restores them in the reply", async () => {
    const parsed = report().parsed;
    expect(parsed.email).toBe("jane.doe@example.com"); // the fixture parses as intended

    const provider = scriptedProvider(
      insights({ recommendedImprovements: ["Put [NAME] and [EMAIL_1] at the top."] }),
    );
    const ai = createAtsAi({ provider, routes });
    const outcome = await ai.analyze({ resumeText: RESUME, report: report(), jobDescription: JOB });

    const sent = provider.calls[0]!.messages[0]!.content;
    for (const detail of ["Jane Doe", "jane.doe@example.com", parsed.phone])
      expect(sent).not.toContain(detail);
    expect(userMessage(provider).resume).toContain("[EMAIL_1]");
    expect(userMessage(provider).deterministicReport.parsed.name).toBe("[NAME]");
    expect(outcome.result.recommendedImprovements).toEqual([
      "Put Jane Doe and jane.doe@example.com at the top.",
    ]);
  });

  it("leaves the advice out, so the file name does not carry the name", async () => {
    const withFile = check(RESUME, DEFAULT_POLICY, {
      file: { name: "Jane_Doe_Resume_final_v3 (2).pdf", format: "pdf", bytes: 1_000 },
    });
    expect(JSON.stringify(withFile.advice)).toMatch(/Jane.Doe/); // the advice quotes it
    const provider = scriptedProvider(insights());
    await createAtsAi({ provider, routes }).analyze({ resumeText: RESUME, report: withFile });

    expect(provider.calls[0]!.messages[0]!.content).not.toMatch(/jane/i);
    expect(userMessage(provider).deterministicReport.advice).toBeUndefined();
  });

  it("sends contact details when redaction is switched off", async () => {
    const provider = scriptedProvider(insights());
    const ai = createAtsAi({ provider, routes, redact: { analyze: false } });
    await ai.analyze({ resumeText: RESUME, report: report() });
    expect(userMessage(provider).resume).toBe(RESUME);
  });

  it("keeps keyword suggestions that point at the posting and drops the rest", async () => {
    const provider = scriptedProvider(
      insights({
        keywordOpportunities: [
          "Kubernetes",
          "Add Kubernetes to your skills section",
          "payments experience",
          "Blockchain",
        ],
      }),
    );
    const ai = createAtsAi({ provider, routes });
    const outcome = await ai.analyze({ resumeText: RESUME, report: report(), jobDescription: JOB });

    expect(outcome.result.keywordOpportunities).toEqual([
      "Kubernetes",
      "Add Kubernetes to your skills section",
      "payments experience",
    ]);
    expect(outcome.rejected).toEqual([{ path: "keywordOpportunities[3]", value: "Blockchain" }]);
  });

  it("drops every keyword suggestion when there is no posting for one to point at", async () => {
    // Without a posting a suggestion is the model's own idea of the role.
    const provider = scriptedProvider(insights({ keywordOpportunities: ["Blockchain"] }));
    const ai = createAtsAi({ provider, routes });
    const outcome = await ai.analyze({ resumeText: RESUME, report: report() });

    expect(outcome.result.keywordOpportunities).toEqual([]);
    expect(outcome.rejected).toEqual([{ path: "keywordOpportunities[0]", value: "Blockchain" }]);
    expect(userMessage(provider).jobDescription).toBeNull();
  });

  it("caps the job description it sends", async () => {
    const provider = scriptedProvider(insights());
    const ai = createAtsAi({ provider, routes });
    await ai.analyze({ resumeText: RESUME, report: report(), jobDescription: "x".repeat(30_000) });
    expect(userMessage(provider).jobDescription).toHaveLength(20_000);
  });

  it("cuts the resume it sends to the 50,000 characters the engine reads", async () => {
    const provider = scriptedProvider(insights());
    const ai = createAtsAi({ provider, routes, redact: { analyze: false } });
    await ai.analyze({ resumeText: `${RESUME}\n${"x".repeat(60_000)}`, report: report() });
    expect(userMessage(provider).resume).toHaveLength(50_000);
  });

  it.each([
    ["phone", "(415) 555-0199", /\(?415|555-?0/],
    ["email", "jane.doe@example.com", /jane|@exam/],
  ])("cuts after redacting, so a %s across the cut is not half sent", async (_, detail, half) => {
    // The detail starts six characters before the 50,000th, where a cut first leaves its head.
    const before = `${RESUME}\n${"x".repeat(50_000 - RESUME.length - 1 - 7)} `;
    const provider = scriptedProvider(insights());
    const ai = createAtsAi({ provider, routes });
    await ai.analyze({ resumeText: `${before}${detail} and more`, report: report() });
    const sent = userMessage(provider).resume;
    expect(sent.length).toBeLessThanOrEqual(50_000);
    expect(sent).not.toMatch(half);
    expect(sent).not.toMatch(/\[[A-Z_0-9]*$/); // nor half a placeholder
  });

  it("sends nothing from past the cut that redaction pulled in", async () => {
    // Redaction shrinks long emails, so the characters sent must not reach past the cut.
    const email = "jane.doe.portfolio.contact@janedoe-consulting.example.com";
    const head = `${RESUME}\n${`Reach me at ${email}\n`.repeat(25)}`;
    const text = `${head}${"x".repeat(51_000 - head.length - 7)} (415) 555-0199 and more`;
    const provider = scriptedProvider(insights());
    const ai = createAtsAi({ provider, routes });
    await ai.analyze({ resumeText: text, report: report() });
    const sent = userMessage(provider).resume;
    expect(sent.length).toBeLessThanOrEqual(50_000);
    expect(sent).not.toMatch(/415|555/);
    expect(sent).not.toContain("and more");
  });

  it("sends nothing past the cut when a long email the cut falls in shrinks to its placeholder", async () => {
    const email = "jane.doe.portfolio.contact@janedoe-consulting.example.com";
    const head = `${RESUME}\n${"x".repeat(50_000 - RESUME.length - 1 - 40)} `;
    const text = `${head}${email} past the cut`;
    const provider = scriptedProvider(insights());
    const ai = createAtsAi({ provider, routes });
    await ai.analyze({ resumeText: text, report: report() });
    const sent = userMessage(provider).resume;
    expect(sent).not.toContain("past");
    expect(sent).not.toMatch(/janedoe|\[[A-Z_0-9]*$/);
  });
});

describe("redaction", () => {
  const parsed = {
    name: "Jane Doe",
    email: "jane@example.com",
    phone: "415 555 0199",
    links: [],
    roles: [],
  };

  it("does not sweep date ranges that look like phone numbers", () => {
    const redaction = createRedaction(parsed, "2019 - 2023");
    expect(redaction.apply("Acme, 2019 - 2023")).toBe("Acme, 2019 - 2023");
  });

  it("catches email addresses the parser did not extract", () => {
    const redaction = createRedaction(parsed, "Refs: boss@corp.example.org");
    expect(redaction.apply("Refs: boss@corp.example.org")).toBe("Refs: [EMAIL_2]");
  });

  it("never replaces a value too short to be safe", () => {
    const redaction = createRedaction({ ...parsed, name: "Al" }, "");
    expect(redaction.apply("Algorithms")).toBe("Algorithms");
  });

  it("round-trips nested values", () => {
    const redaction = createRedaction(parsed, "");
    const value = { a: ["Jane Doe", { b: "call 415 555 0199" }], n: 3 };
    expect(redaction.restore(redaction.apply(value))).toEqual(value);
  });

  // One pass over the text, not one per distinct address; each still restores to itself.
  it("redacts thousands of distinct email addresses in one pass", () => {
    const hostile = Array.from({ length: 8_000 }, (_, i) => `u${i}@b.co`).join(" ");
    const redaction = createRedaction(parsed, hostile);
    // The text and the strings of a report, as `analyze` redacts them.
    const strings = Array.from({ length: 10 }, () => hostile);
    const redacted = expectFast(() => redaction.apply(strings), 1_000);
    expect(redacted[0]).not.toContain("@b.co");
    expect(redaction.restore(redacted)).toEqual(strings);
  });

  it.each(["a", "a.", "a-", "1.", "é.", "a.a-", "https://a."])(
    "finds web addresses in linear time in 150,000 characters of %j",
    (shape) => {
      // Longer than the engine reads: a library caller can pass any text.
      const hostile = shape.repeat(Math.ceil(150_000 / shape.length));
      expectFast(() => createRedaction(parsed, hostile).apply(hostile), 1_000, shape);
    },
  );

  it.each(["0", "0 ", "011 ", "0011 44 ", "010 4 ", "011 44 20 7946 095 "])(
    "finds a phone after an exit prefix in linear time in 150,000 characters of %j",
    (shape) => {
      const hostile = shape.repeat(Math.ceil(150_000 / shape.length));
      const international = { ...parsed, phone: "+44 20 7946 0958" };
      expectFast(() => createRedaction(international, hostile).apply(hostile), 1_000, shape);
    },
  );

  it.each([
    "+1 ",
    "(0",
    "0-",
    "01/2020 - ",
    "(01/2020 - 12/2023 / ",
    "0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 ",
    "+" + "1".repeat(20),
    "(415) 555-",
    "415-555-",
    "1-415.555.",
  ])(
    "finds a phone the parser did not read in linear time in 150,000 characters of %j",
    (shape) => {
      const hostile = shape.repeat(Math.ceil(150_000 / shape.length));
      const redaction = createRedaction({ ...parsed, phone: "" }, hostile);
      expectFast(() => redaction.restore(redaction.apply(hostile)), 1_000, shape);
    },
  );
});

describe("repairParse", () => {
  const SOURCE = "Jane Doe\nSenior Engineer, Acme Corporation\nJan 2020 - Present\n";
  const empty = check("x", DEFAULT_POLICY).parsed;

  it("fills empty fields with grounded values and reports the ungrounded ones", async () => {
    const provider = scriptedProvider(
      JSON.stringify({
        name: "Jane Doe",
        roles: [
          {
            title: "Senior Engineer",
            employer: "Initech",
            start: { year: 2020, month: 1 },
            end: null,
            current: true,
          },
        ],
      }),
    );
    const ai = createAtsAi({ provider, routes });
    const outcome = await ai.repairParse({ resumeText: SOURCE, report: { parsed: empty } });

    expect(outcome.result.name).toBe("Jane Doe");
    expect(outcome.result.provenance.name).toBe("ai");
    expect(outcome.result.roles[0]).toMatchObject({ title: "Senior Engineer", employer: "" });
    expect(outcome.rejected).toEqual([{ path: "roles[0].employer", value: "Initech" }]);
  });

  it("sends the document as data inside a JSON envelope, without redaction", async () => {
    const provider = scriptedProvider(JSON.stringify({ name: "Jane Doe" }));
    const ai = createAtsAi({ provider, routes });
    await ai.repairParse({ resumeText: SOURCE, report: { parsed: empty } });

    const sent = JSON.parse(provider.calls[0]!.messages[0]!.content);
    expect(sent.resume).toBe(SOURCE);
  });
});

describe("convertResume", () => {
  it("blanks identity values that do not occur in the source and keeps the rest", async () => {
    const provider = scriptedProvider(
      JSON.stringify({
        basics: {
          fullName: "Jane Doe",
          email: "jane@fabricated.example",
          phone: "+1 415 555 0199",
        },
        experience: [
          {
            company: "Acme Corporation",
            role: "Staff Engineer",
            startDate: "2020-01",
            highlights: ["Reworded bullet"],
          },
        ],
      }),
    );
    const ai = createAtsAi({ provider, routes });
    const outcome = await ai.convertResume({ resumeText: RESUME });

    expect(outcome.result.basics).toMatchObject({
      fullName: "Jane Doe",
      email: "",
      phone: "+1 415 555 0199", // normalised downstream, so exempt
    });
    expect(outcome.result.experience[0]).toMatchObject({
      company: "Acme Corporation",
      role: "", // "Staff" is not in the document
      startDate: "2020-01",
      highlights: ["Reworded bullet"],
    });
    expect(outcome.rejected.map((violation) => violation.path)).toEqual([
      "basics.email",
      "experience[0].role",
    ]);
  });
});

describe("groundedText and convertedToDocument", () => {
  const converted = {
    basics: { fullName: "Jane Doe", role: "", headline: "", email: "", phone: "", location: "" },
    links: [],
    summary: "Award-winning Kubernetes AWS Terraform expert.",
    experience: [
      {
        company: "Acme Corporation",
        role: "Senior Engineer",
        location: "",
        startDate: "2020-01",
        endDate: "",
        current: true,
        summary: "",
        highlights: [
          "Built payment systems in TypeScript, cutting failures 40%.",
          // Planted by the model, or by text in the resume that steered it: not in the file.
          "Led Kubernetes AWS Terraform migration",
        ],
      },
      // Its identity was blanked as ungrounded: dropped, never scored on its bullets.
      {
        company: "",
        role: "",
        location: "",
        startDate: "",
        endDate: "",
        current: false,
        summary: "",
        highlights: ["Grew revenue 300%"],
      },
    ],
    education: [],
    projects: [],
    skills: [{ name: "Skills", keywords: ["TypeScript"] }],
  };

  it("drops the summaries and bullets the resume does not have, and scores the rest", () => {
    const { resume, dropped } = groundedText(converted, RESUME);
    expect(dropped).toEqual([
      "Award-winning Kubernetes AWS Terraform expert.",
      "Led Kubernetes AWS Terraform migration",
      "Grew revenue 300%",
    ]);
    const document = convertedToDocument(resume);
    const report = check(document, DEFAULT_POLICY, {
      jobDescription: JOB,
      now: new Date("2026-10-01"),
    });
    expect(report.parsed.roles).toEqual([
      expect.objectContaining({ title: "Senior Engineer", employer: "Acme Corporation" }),
    ]);
    expect(report.matchedKeywords).not.toContain("kubernetes");
  });
});
