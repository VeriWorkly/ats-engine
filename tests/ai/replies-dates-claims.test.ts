import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createAtsAi } from "../../src/ai/index.js";
import type { LlmProvider } from "../../src/ai/provider.js";
import { createRedaction } from "../../src/ai/redact.js";
import { main } from "../../src/cli/main.js";
import { PLAIN } from "../../src/cli/terminal.js";
import { DEFAULT_POLICY, check } from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import { mergeGrounded, writtenYears, type AtsRepairCandidate } from "../../src/repair/merge.js";
import { expectFastAsync } from "../fixtures/timing.js";

const NOW = new Date("2026-06-01");
const empty = check("", DEFAULT_POLICY, { now: NOW }).parsed;

describe("repair: a role is current when its own range says so", () => {
  const current = (
    source: string,
    start: { year: number; month: number | null },
    policy = DEFAULT_POLICY,
  ) => {
    const candidate: AtsRepairCandidate = {
      name: "",
      email: "",
      phone: "",
      roles: [{ title: "Engineer", employer: "Acme Corp", start, end: null, current: true }],
      education: [],
      skills: [],
    };
    return mergeGrounded(empty, candidate, source, { policy, now: NOW }).merged.roles[0]?.current;
  };

  it.each([
    ["Acme Corp, Engineer, Jan 2019 to Present", { year: 2019, month: 1 }],
    ["Acme Corp, Engineer, 2019 to date", { year: 2019, month: null }],
    ["Acme Corp, Engineer, 03/19 - Present", { year: 2019, month: 3 }],
    ["Acme Corp, Engineer, Jan 2019 - Present", { year: 2019, month: 1 }],
  ])("reads %j as ongoing", (source, start) => {
    expect(current(source, start)).toBe(true);
  });

  it("reads German 'bis heute'", () => {
    const source = [
      "Berufserfahrung",
      "Acme Corp, Engineer, 03/2019 bis heute",
      "- Entwicklung von Systemen mit der Plattform und für das Team bei der Firma",
    ].join("\n");
    expect(
      current(source, { year: 2019, month: 3 }, withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES)),
    ).toBe(true);
  });

  it("still refuses a finished role that a bullet calls 'now'", () => {
    expect(
      current("Acme Corp, Engineer, 2010 - 2012\n- Now used by 2 million users", {
        year: 2010,
        month: null,
      }),
    ).toBe(false);
  });
});

describe("two-digit years only in a date", () => {
  it("does not read version numbers, grades or counts as years", () => {
    expect([...writtenYears("GPA 3.85, Python 3.11, Node 18.20, 4-12 people")]).toEqual([]);
  });

  it("reads an apostrophe, a month and the end of a year range", () => {
    expect([...writtenYears("Jan '19 - 03/21, 2019–22")].sort()).toEqual([
      1919, 1921, 1922, 2019, 2021, 2022,
    ]);
  });

  it("does not ground a start year from 'Python 3.11'", () => {
    const candidate: AtsRepairCandidate = {
      name: "",
      email: "",
      phone: "",
      roles: [
        {
          title: "Engineer",
          employer: "Acme Corp",
          start: { year: 2011, month: null },
          end: { year: 2023, month: null },
          current: false,
        },
      ],
      education: [],
      skills: [],
    };
    const { merged } = mergeGrounded(
      empty,
      candidate,
      "Acme Corp, Engineer, 2021 - 2023\n- Python 3.11",
      {
        policy: DEFAULT_POLICY,
        now: NOW,
      },
    );
    expect(merged.roles[0]?.start).toBeNull();
  });
});

describe("analyze: a punctuated name is still a claim", () => {
  const RESUME =
    "Jane Doe\nSenior Engineer, Acme Corporation, 2020 - Present\n- Built infrastructure in Terraform";
  const JOB = "We need Terraform experience.";
  it.each([
    "Add Terraform from your work at (Google)",
    'Add Terraform "Google" certified',
    "Terraform (IaC)",
  ])("drops %j", async (item) => {
    const provider: LlmProvider = {
      complete: async () => ({
        text: JSON.stringify({ keywordOpportunities: [item] }),
        finish: "stop",
      }),
    };
    const ai = createAtsAi({ provider, routes: { analyze: { model: "m", maxTokens: 100 } } });
    const report = check(RESUME, DEFAULT_POLICY, {
      jobDescription: JOB,
      now: NOW,
    });
    const { result } = await ai.analyze({ resumeText: RESUME, report, jobDescription: JOB });
    expect(result.keywordOpportunities).toEqual([]);
  });
});

describe("reasoning-model replies", () => {
  const INSIGHTS = JSON.stringify({ explanation: "Fine." });
  const read = async (text: string) => {
    const ai = createAtsAi({
      provider: { complete: async () => ({ text, finish: "stop" }) },
      routes: { analyze: { model: "m", maxTokens: 100 } },
    });
    return (await ai.analyze({ resumeText: "x", report: check("x", DEFAULT_POLICY) })).result
      .explanation;
  };

  it.each([
    ["a closing </think> without its opener", `The user wants {a plan}.\n</think>\n${INSIGHTS}`],
    ["a sentence after the JSON", `${INSIGHTS}\nHope this helps!`],
    ["braces in prose before the JSON", `I considered {options} first. Here: ${INSIGHTS}`],
    [
      "a JSON string holding a fence",
      JSON.stringify({ explanation: "Fine.", missingEvidence: ["```x```"] }),
    ],
    ["a fenced block after prose", `Here it is:\n\`\`\`json\n${INSIGHTS}\n\`\`\`\nDone.`],
    ["a fence on one line", `\`\`\`json${INSIGHTS}\`\`\``],
    // The first object that parsed was taken, though it was not the answer.
    [
      "a JSON example before the answer",
      `The shape is {"note": "an example"}. Answer: ${INSIGHTS}`,
    ],
    [
      "a fenced example before the answer",
      `\`\`\`json\n{"keys": ["explanation"]}\n\`\`\`\n\`\`\`json\n${INSIGHTS}\n\`\`\``,
    ],
  ])("reads %s", async (_label, text) => {
    expect(await read(text)).toBe("Fine.");
  });

  // A reply in another shape parsed as an empty analysis: a paid call, nothing back, no error.
  const WRAPPED = JSON.stringify({ analysis: { explanation: "Fine." } });
  it.each([
    ["wrapped in another key", WRAPPED],
    // Only a bare wrapped reply was refused: in a fence or prose, its inner object was read.
    ["wrapped in another key, in a fence", `\`\`\`json\n${WRAPPED}\n\`\`\``],
    ["wrapped in another key, after prose", `Here you go: ${WRAPPED}`],
    ["wrapped in another key, before prose", `${WRAPPED}\nHope this helps!`],
    ["wrapped in another key, after an example", `Shape: {"note": 1}. Answer: ${WRAPPED}`],
    // The outer object is the answer; a fragment inside it is not.
    [
      "whose answer fails the schema, holding an object that fits",
      `Here: {"explanation": "Outer", "priorityOrder": [{"explanation": "Inner"}]}`,
    ],
    ["with nothing in it", JSON.stringify({ explanation: " ", priorityOrder: [] })],
    ["with only blank items", JSON.stringify({ priorityOrder: [" "], missingEvidence: [null] })],
    // Without a posting, keyword suggestions are dropped: nothing would be left.
    ["with only keyword suggestions and no posting", '{"keywordOpportunities": ["Kubernetes"]}'],
  ])("refuses a reply %s", async (_label, text) => {
    await expect(read(text)).rejects.toMatchObject({ code: "invalid_output" });
  });

  // Each object inside a nested reply was read to its end: 4.8 MB took 4.8 s, ten times a flat one.
  it("reads a deeply nested reply after prose in bounded time", async () => {
    const text = `x ${'{"a":'.repeat(800_000)}1${"}".repeat(800_000)}`;
    await expectFastAsync(
      () => expect(read(text)).rejects.toMatchObject({ code: "invalid_output" }),
      1_500,
    );
  });

  // Unclosed fences must not make the scan quadratic; a reply may run to 4 MB.
  it("refuses a reply of open fences in bounded time", async () => {
    const text = `${"```{".repeat(60_000)}${INSIGHTS}`;
    await expectFastAsync(
      () => expect(read(text)).rejects.toMatchObject({ code: "invalid_output" }),
      1_000,
    );
  });
});

describe("redaction of phone numbers and names", () => {
  const redaction = (name: string, phone: string) =>
    createRedaction({ name, email: "", phone, links: [], roles: [] }, "");

  it("keeps a trunk zero inside the number, and restores it whole", () => {
    const r = redaction("Jane Doe", "+44 20 7946 0958");
    expect(r.apply("Call +44 (0)20 7946 0958 today")).toBe("Call [PHONE] today");
  });

  it("does not take a list number for a country code", () => {
    expect(redaction("Jane Doe", "(415) 555-0199").apply("3. 415-555-0199")).toBe("3. [PHONE]");
  });

  it("does not redact a word that spells the name without its space", () => {
    expect(redaction("Tim Ely", "").apply("Tim Ely delivered timely reports")).toBe(
      "[NAME] delivered timely reports",
    );
    expect(redaction("Jane Doe", "").apply("J A N E   D O E")).toBe("[NAME]");
  });
});

describe("CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "ats-review-fixes-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  let out: string[];
  let err: string[];
  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void out.push(line));
    vi.spyOn(console, "error").mockImplementation((line: string) => void err.push(line));
  });
  const context = { terminal: PLAIN, env: {} };
  const resume = join(dir, "resume.txt");
  writeFileSync(
    resume,
    "Jane Doe\njane@example.com\n\nExperience\nSenior Engineer, Acme \u009b31m Corp\nJan 2020 - Present\n- Built payment systems.",
  );

  it("keeps C1 control characters out of --json too", async () => {
    expect(await main(["check", resume, "--json"], context)).toBe(0);
    expect(out.join("\n")).not.toContain("\u009b");
    expect(JSON.parse(out.join("\n")).readinessScore).toEqual(expect.any(Number));
  });

  it("names a missing --policy file plainly", async () => {
    expect(await main(["check", resume, "--policy", join(dir, "missing.json")], context)).toBe(1);
    expect(err.join("\n")).toMatch(/No such file: /);
  });

  it("names a --policy file that is not JSON", async () => {
    const policy = join(dir, "policy.json");
    writeFileSync(policy, "{");
    expect(await main(["check", resume, "--policy", policy], context)).toBe(1);
    expect(err.join("\n")).toMatch(/is not valid JSON/);
  });
});
