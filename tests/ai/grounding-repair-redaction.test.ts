import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { createRedaction } from "../../src/ai/redact.js";
import { createAtsAi } from "../../src/ai/index.js";
import { openAiCompatible } from "../../src/ai/openai-compatible.js";
import type { LlmProvider } from "../../src/ai/provider.js";
import { resolveAiConfig } from "../../src/cli/ai.js";
import { main, type CliContext } from "../../src/cli/main.js";
import { detectTerminal, PLAIN, printable } from "../../src/cli/terminal.js";
import { formatParsedDate, formatTenure } from "../../src/format/index.js";
import { AtsScoringService, DEFAULT_POLICY, type AtsParsedResume } from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import { isGrounded, normalizeForGrounding } from "../../src/repair/grounding.js";
import { mergeGrounded, type AtsRepairCandidate } from "../../src/repair/merge.js";

const NOW = new Date("2024-06-01");

describe("grounding: a value never spans a list separator", () => {
  const grounded = (value: string, source: string) =>
    isGrounded(value, normalizeForGrounding(source));

  it.each([
    ["Acme Globex", "Clients: Acme, Globex"],
    ["Engineer Acme", "Software Engineer, Acme"],
    ["Python Rust", "Python | Rust"],
  ])("rejects %j built across a separator in %j", (value, source) => {
    expect(grounded(value, source)).toBe(false);
  });

  it.each([
    ["Acme Inc", "Acme, Inc."],
    ["Acme, Inc.", "Acme, Inc."],
    ["Python, SQL", "Skills: Python, SQL"],
    ["Senior Software Engineer", "Senior Software\nEngineer"],
    ["Full-Stack Developer", "Full-Stack Developer at Acme"],
  ])("accepts %j from %j", (value, source) => {
    expect(grounded(value, source)).toBe(true);
  });

  it("does not take a short skill from a word glued by & or -", () => {
    expect(grounded("R", "Led R&D for payments")).toBe(false);
    expect(grounded("Go", "Built go-to-market plans")).toBe(false);
    expect(grounded("R", "Skills: Python, R, SQL")).toBe(true);
    expect(grounded("C", "Languages: C/C++, Go")).toBe(true);
  });
});

describe("repair: dates and current", () => {
  const empty: AtsParsedResume = AtsScoringService.check("", DEFAULT_POLICY, { now: NOW }).parsed;
  const role = (overrides: Partial<AtsRepairCandidate["roles"][number]>) => ({
    title: "Analyst",
    employer: "Globex Ltd",
    start: { year: 2010, month: null },
    end: { year: 2012, month: null },
    current: false,
    ...overrides,
  });
  const candidate = (roles: AtsRepairCandidate["roles"]): AtsRepairCandidate => ({
    name: "",
    email: "",
    phone: "",
    roles,
    education: [],
    skills: [],
  });

  it("does not make a finished role current because 'now' appears in a bullet", () => {
    const source = "Globex Ltd, Analyst, 2010 - 2012\n- Now used by 2 million users";
    const { merged } = mergeGrounded(empty, candidate([role({ current: true })]), source, {
      policy: DEFAULT_POLICY,
      now: NOW,
    });
    expect(merged.roles[0]).toMatchObject({ current: false, end: { year: 2012 } });
  });

  it("accepts current when the role's own dates say so", () => {
    const source = "Globex Ltd, Analyst, 2010 - Present";
    const { merged } = mergeGrounded(
      empty,
      candidate([role({ current: true, end: null })]),
      source,
      { policy: DEFAULT_POLICY, now: NOW },
    );
    expect(merged.roles[0]).toMatchObject({ current: true, end: null });
  });

  it("reads the resume's own language: 'heute' ends a German role", () => {
    const source = [
      "Berufserfahrung",
      "Acme GmbH, Ingenieur, 01/2020 - heute",
      "- Entwicklung von Zahlungssystemen mit TypeScript und Go für den Handel",
      "- Verantwortung für das Team bei der Einführung von Kubernetes auf der Plattform",
      "Ausbildung",
      "B.Sc. Informatik an der Universität Bonn",
    ].join("\n");
    const { merged } = mergeGrounded(
      empty,
      candidate([
        role({
          title: "Ingenieur",
          employer: "Acme GmbH",
          start: { year: 2020, month: 1 },
          end: null,
          current: true,
        }),
      ]),
      source,
      { policy: withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES), now: NOW },
    );
    expect(merged.roles[0]).toMatchObject({ current: true });
    expect(merged.monthsOfExperience).toBeGreaterThan(40);
  });

  it("accepts a year the document writes in two digits", () => {
    const source = "Globex Ltd, Analyst, Jan '19 - Mar '21";
    const { merged } = mergeGrounded(
      empty,
      candidate([role({ start: { year: 2019, month: 1 }, end: { year: 2021, month: 3 } })]),
      source,
      { policy: DEFAULT_POLICY, now: NOW },
    );
    expect(merged.roles[0]).toMatchObject({ start: { year: 2019 }, end: { year: 2021 } });
  });
});

describe("redaction variants", () => {
  const parsed = (name: string, phone = "(415) 555-0199") => ({
    name,
    email: "jane@acme.dev",
    phone,
    links: [],
    roles: [],
  });

  it("replaces an address built from the name whole, and restores it", () => {
    const source = "Jane Doe\njanedoe.dev | x.com/janedoe";
    const redaction = createRedaction(parsed("Jane Doe"), source);
    const hidden = redaction.apply(source);
    expect(hidden).not.toMatch(/jane/i);
    expect(hidden).not.toContain("[NAME].dev");
    expect(redaction.restore("Your site [LINK_1]")).toBe("Your site janedoe.dev");
  });

  it("catches 'Doe, Jane', a missing middle initial, a curly apostrophe and other phone formats", () => {
    expect(createRedaction(parsed("JANE DOE"), "").apply("DOE, JANE")).toBe("[NAME]");
    expect(createRedaction(parsed("Jane Q. Doe"), "").apply("Jane Doe led it")).toBe(
      "[NAME] led it",
    );
    expect(createRedaction(parsed("Mary O'Neil"), "").apply("Mary O’Neil")).toBe("[NAME]");
    expect(createRedaction(parsed("Jane Doe"), "").apply("Call 415.555.0199")).toBe("Call [PHONE]");
  });

  it("leaves a longer hyphenated name and date ranges alone", () => {
    const redaction = createRedaction(parsed("Jane Doe"), "");
    expect(redaction.apply("Jane Doe-Smith")).toBe("Jane Doe-Smith");
    expect(redaction.apply("2019 - 2023")).toBe("2019 - 2023");
  });
});

describe("analyze: keyword suggestions and the request", () => {
  const RESUME = "Jane Doe\nSenior Engineer, Acme Corporation, 2020 - Present\n- Built APIs in Go";
  const JOB = "We need Kubernetes and Go experience.";
  const reply = (keywordOpportunities: string[]): LlmProvider => ({
    async complete() {
      return {
        text: JSON.stringify({
          explanation: "",
          missingEvidence: [],
          keywordOpportunities,
          recommendedImprovements: [],
          priorityOrder: [],
        }),
        finish: "stop",
      };
    },
  });
  const route = { analyze: { model: "m", maxTokens: 100 } };

  it("drops a sentence that smuggles in a number or a name the posting and resume lack", async () => {
    const report = AtsScoringService.check(RESUME, DEFAULT_POLICY, {
      jobDescription: JOB,
      now: NOW,
    });
    const ai = createAtsAi({
      provider: reply([
        "Add Kubernetes to your skills section",
        "Add Kubernetes and claim 10 years at Google",
      ]),
      routes: route,
    });
    const { result, rejected } = await ai.analyze({
      resumeText: RESUME,
      report,
      jobDescription: JOB,
    });
    expect(result.keywordOpportunities).toEqual(["Add Kubernetes to your skills section"]);
    expect(rejected.map((item) => item.value)).toEqual([
      "Add Kubernetes and claim 10 years at Google",
    ]);
  });

  it("does not send the text as read twice", async () => {
    const report = AtsScoringService.check(RESUME, DEFAULT_POLICY, {
      now: NOW,
      includeLines: true,
    });
    let sent = "";
    const ai = createAtsAi({
      provider: {
        async complete(request) {
          sent = request.messages[0]!.content;
          return { text: JSON.stringify({ explanation: "" }), finish: "stop" };
        },
      },
      routes: route,
    });
    await ai.analyze({ resumeText: RESUME, report });
    expect(JSON.parse(sent).deterministicReport.lines).toBeUndefined();
  });
});

describe("replies from reasoning models", () => {
  const INSIGHTS = JSON.stringify({ explanation: "Fine." });
  const run = async (text: string) => {
    const ai = createAtsAi({
      provider: { complete: async () => ({ text, finish: "stop" }) },
      routes: { analyze: { model: "m", maxTokens: 100 } },
    });
    return (
      await ai.analyze({ resumeText: "x", report: AtsScoringService.check("x", DEFAULT_POLICY) })
    ).result.explanation;
  };

  it.each([
    ["a <think> block first", `<think>The user wants JSON.</think>\n${INSIGHTS}`],
    ["prose before a fence", `Here is the analysis:\n\`\`\`json\n${INSIGHTS}\n\`\`\``],
    ["prose before the object", `Sure. ${INSIGHTS}`],
  ])("reads the JSON after %s", async (_label, text) => {
    expect(await run(text)).toBe("Fine.");
  });

  it("keeps only the text parts of a content array", async () => {
    const provider = openAiCompatible({
      apiKey: "k",
      fetch: async () => ({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [
              {
                finish_reason: "stop",
                message: {
                  content: [
                    { type: "reasoning", text: "Thinking about it..." },
                    { type: "text", text: INSIGHTS },
                  ],
                },
              },
            ],
          }),
      }),
    });
    const response = await provider.complete({
      model: "m",
      system: "",
      messages: [],
      maxTokens: 10,
    });
    expect(response.text).toBe(INSIGHTS);
  });
});

describe("convertResume: dates and current are grounded", () => {
  it("blanks an invented year and turns off an unsupported current", async () => {
    const source = "Jane Doe\nAcme Corporation, Engineer, 2018 - 2020\n- Now used widely";
    const ai = createAtsAi({
      provider: {
        complete: async () => ({
          text: JSON.stringify({
            basics: { fullName: "Jane Doe" },
            experience: [
              {
                company: "Acme Corporation",
                role: "Engineer",
                startDate: "1990-01",
                endDate: "2020",
                current: true,
              },
            ],
          }),
          finish: "stop",
        }),
      },
      routes: { convertResume: { model: "m", maxTokens: 100 } },
    });
    const { result, rejected } = await ai.convertResume({ resumeText: source });
    expect(result.experience[0]).toMatchObject({ startDate: "", endDate: "2020", current: false });
    expect(rejected.map((item) => item.path)).toEqual([
      "experience[0].startDate",
      "experience[0].current",
    ]);
  });
});

describe("CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "ats-cli-fixes-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const file = (name: string, content: string) => {
    const path = join(dir, name);
    writeFileSync(path, content);
    return path;
  };
  const RESUME = [
    "Jane Doe",
    "jane.doe@example.com | (415) 555-0199",
    "",
    "Experience",
    "Senior Engineer, Acme Corporation",
    "Jan 2020 - Present",
    "- Built payment systems in TypeScript, cutting failures 40%.",
    "",
    "Education",
    "BSc Computer Science, State University, 2015",
    "",
    "Skills",
    "TypeScript, Go, PostgreSQL",
  ].join("\n");
  const resume = file("resume.txt", RESUME);
  const context = (overrides: Partial<CliContext> = {}): CliContext => ({
    terminal: PLAIN,
    env: {},
    ...overrides,
  });

  let out: string[];
  let err: string[];
  beforeEach(() => {
    out = [];
    err = [];
    vi.spyOn(console, "log").mockImplementation((line: string) => void out.push(line));
    vi.spyOn(console, "error").mockImplementation((line: string) => void err.push(line));
  });

  it("never prints control characters from the resume", async () => {
    const escape = String.fromCharCode(27);
    const path = file(
      "escape.txt",
      RESUME.replace("Acme", `Acme${escape}[31mRED${escape}[0m`) +
        `\n${escape}]0;pwned${String.fromCharCode(7)}`,
    );
    expect(await main(["check", path, "--text"], context())).toBe(0);
    expect(out.join("\n")).not.toContain(escape);
    expect(out.join("\n")).not.toContain(String.fromCharCode(7));
  });

  it("lists each requirement of a posting in the text output", async () => {
    const job = file(
      "job.txt",
      "Requirements:\n- 3+ years of TypeScript\n- Experience with Kubernetes",
    );
    expect(await main(["check", resume, "--job", job], context())).toBe(0);
    const printed = out.join("\n");
    expect(printed).toMatch(/Requirements met: \d of 2/);
    expect(printed).toMatch(/\[(met|partial|missing|unverifiable)\]\s+.*Kubernetes/);
  });

  it("reads a posting saved as a PDF or DOCX file through the extractor, not as raw bytes", async () => {
    const job = file("job.docx", "not really a docx");
    expect(await main(["check", resume, "--job", job], context())).toBe(1);
    expect(err.join("\n")).not.toMatch(/PK|mozilla/i);
  });

  it.each([
    [["check", join(dir, "missing.txt")], /No such file: /],
    [["check", dir + "/folder.txt"], /is a folder, not a file/],
    [["check", "resume.rtf"], /Unsupported resume file type "\.rtf"\. Use \.pdf, \.docx/],
    [
      ["check", resume, "--frobnicate"],
      /Unknown option --frobnicate\. Run "ats-engine check --help"/,
    ],
    [["check", resume, "--min-score="], /--min-score must be a number/],
    [["check", resume, "--min-score=-5"], /--min-score must be a number/],
    [["score", resume], /unknown command "score"/],
  ])("explains %j plainly", async (argv, message) => {
    mkdirSync(join(dir, "folder.txt"), { recursive: true });
    expect(await main(argv as string[], context())).toBe(1);
    expect(err.join("\n")).toMatch(message);
  });

  it("refuses JSON that is not a resume, and broken JSON, with a clear message", async () => {
    expect(await main(["check", file("foo.json", '{"foo":1}')], context())).toBe(1);
    expect(err.join("\n")).toMatch(/neither a JSON Resume nor an ats-resume document/);
    err = [];
    expect(await main(["check", file("broken.json", "{")], context())).toBe(1);
    expect(err.join("\n")).toMatch(/is not valid JSON/);
  });

  it("prints the version after check too", async () => {
    expect(await main(["check", resume, "--version"], context())).toBe(0);
    expect(out).toHaveLength(1);
  });

  it("says why it exits 2, and keeps 2 when the analysis also fails", async () => {
    const fetch = async () => ({ ok: false, status: 500, text: async () => "down" });
    const code = await main(
      ["check", resume, "--min-score", "100", "--ai", "--provider", "ollama", "--model", "m"],
      context({ fetch }),
    );
    expect(code).toBe(2);
    expect(err.join("\n")).toMatch(/Readiness \d+ is below --min-score 100\./);
  });

  it("ignores ATS_AI_BASE_URL for a provider named by flag, and refuses a key over plain http", () => {
    const env = { ATS_AI_BASE_URL: "http://gpu-box.lan:8000/v1", OPENAI_API_KEY: "k" };
    expect(resolveAiConfig({ provider: "openai", model: "m" }, env)).toMatchObject({
      baseUrl: undefined,
      host: "api.openai.com",
    });
    // Without a provider named, the endpoint applies, with the shared key.
    expect(() => resolveAiConfig({ model: "m" }, { ...env, ATS_AI_API_KEY: "k" })).toThrow(
      /plain http to gpu-box\.lan:8000/,
    );
  });

  it("treats CI=false as not CI", () => {
    const tty = { isTTY: true, getColorDepth: () => 8 };
    expect(detectTerminal(tty, { CI: "false" }).interactive).toBe(true);
    expect(detectTerminal(tty, { CI: "true" }).interactive).toBe(false);
  });

  it("strips control characters at any depth", () => {
    expect(printable({ a: ["x\u001b[2Jy"], b: "ok\n\tfine" })).toEqual({
      a: ["x[2Jy"],
      b: "ok\n\tfine",
    });
  });
});

describe("format edge cases", () => {
  it("formats odd tenures as whole, non-negative months", () => {
    expect(formatTenure(-3)).toBe("0 mo");
    expect(formatTenure(Number.NaN)).toBe("0 mo");
    expect(formatTenure(1.5)).toBe("2 mo");
    expect(formatTenure(14)).toBe("1 yr 2 mo");
  });

  it("formats a month out of range as the year alone", () => {
    expect(formatParsedDate({ year: 2021, month: 13 })).toBe("2021");
  });
});
