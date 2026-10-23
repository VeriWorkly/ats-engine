// The built MCP server over stdio, driven with the SDK's client: each tool's structured answer is
// the engine's `check` on the same input, and a mistake in a call is a tool error, not a crash.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  check,
  computeVerdict,
  DEFAULT_POLICY,
  policyRubric,
  type AtsReport,
} from "../../../src/index.js";
import { printable } from "../../../src/format/index.js";
import { normalizeJobText } from "../../../src/job/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../../src/locales/index.js";
import { extractResume, normalizeExtractedText } from "../../../src/node/extract.js";
import { buildPdf, text } from "../../../tests/fixtures/buildPdf.js";
import { LOCALE_FIXTURES, ITALIAN_RESUME } from "../../../tests/fixtures/locale-resumes.js";

const SERVER = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const PACKAGE = fileURLToPath(new URL("../package.json", import.meta.url));
const SERVER_JSON = fileURLToPath(new URL("../server.json", import.meta.url));
const POLICY = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);

const RESUME = [
  "Jane Doe",
  "jane.doe@example.com | (415) 555-0199",
  "",
  "Experience",
  "Senior Engineer, Acme Corporation",
  "Jan 2020 - Present",
  "- Built payment systems in TypeScript, cutting failures 40%.",
  "- Led a team of five engineers shipping Go services on Kubernetes.",
  "",
  "Education",
  "BSc Computer Science, State University, 2015",
  "",
  "Skills",
  "TypeScript, Go, PostgreSQL",
];

const JOB = [
  "Platform Engineer",
  "Requirements:",
  "- 3+ years of experience with TypeScript and Go",
  "- Experience running services on Kubernetes",
  "- Familiarity with Terraform",
  "- Strong communication and teamwork",
  "Nice to have: Rust",
].join("\n");

const dir = mkdtempSync(join(tmpdir(), "ats-mcp-"));
const pdf = buildPdf(RESUME.map((line, index) => text(72, 740 - index * 14, line)).join("\n"));
const pdfPath = join(dir, "resume.pdf");
const jobPath = join(dir, "job.txt");
writeFileSync(pdfPath, pdf);
writeFileSync(jobPath, JOB);
const credentialsPath = join(dir, "credentials");
writeFileSync(credentialsPath, "[default]\naws_secret_access_key = wJalrXUtnFEMIK7MDENG");
mkdirSync(join(dir, "folder.pdf"));
const damagedPath = join(dir, "damaged.pdf");
writeFileSync(damagedPath, "%PDF-1.4\nnot a PDF past its header");

let client: Client;

beforeAll(async () => {
  if (!existsSync(SERVER))
    throw new Error(`${SERVER} is missing: run "npm run build" before the MCP server's tests.`);
  client = new Client({ name: "ats-engine-mcp-test", version: "0.0.0" });
  // stderr is the server's log; piped so a test run does not print it.
  await client.connect(
    new StdioClientTransport({ command: process.execPath, args: [SERVER], stderr: "pipe" }),
  );
}, 30_000);

afterAll(async () => {
  await client?.close();
  rmSync(dir, { recursive: true, force: true });
});

type ToolResult = {
  isError?: boolean;
  content: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
};

async function call(name: string, args: Record<string, unknown>): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

const textOf = (result: ToolResult) => result.content.map((part) => part.text ?? "").join("\n");

/** What `check_resume` promises, spelled out from the report rather than from the server. */
function expectedCheck(report: AtsReport, withJob: boolean) {
  return JSON.parse(
    JSON.stringify(
      printable({
        readinessScore: report.readinessScore,
        verdict: computeVerdict(report),
        checksPassed: report.checksPassed,
        checksTotal: report.checksTotal,
        wordCount: report.wordCount,
        categories: report.categories,
        failedChecks: report.failedChecks,
        prioritizedFixes: report.prioritizedFixes,
        parsingWarnings: report.parsingWarnings,
        strengths: report.strengths,
        parsed: report.parsed,
        locale: report.locale,
        engine: report.engine,
        advice: report.advice,
        job: withJob
          ? {
              jobMatchScore: report.jobMatchScore,
              requirements: report.requirements,
              matchedKeywords: report.matchedKeywords,
              missingKeywords: report.missingKeywords,
              matchedKeywordGroups: report.matchedKeywordGroups,
              missingKeywordGroups: report.missingKeywordGroups,
            }
          : null,
      }),
    ),
  );
}

async function pdfReport(options: { jobDescription?: string; includeLines?: boolean } = {}) {
  const { text: extracted, layout } = await extractResume(pdf, "pdf");
  const file = { name: "resume.pdf", bytes: pdf.length, format: "pdf" as const };
  return { report: check(extracted, POLICY, { ...options, layout, file }), layout };
}

describe("ats-engine-mcp over stdio", () => {
  it("lists four tools that say the score is a rubric's, for the user's own resume", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "check_resume",
      "explain_rule",
      "extract_text",
      "match_job",
    ]);
    for (const tool of tools) {
      expect(tool.outputSchema).toBeDefined();
      expect(tool.annotations?.readOnlyHint).toBe(true);
      expect(tool.description).toMatch(/user's own resume|rubric/);
    }
    for (const name of ["check_resume", "match_job"]) {
      const description = tools.find((tool) => tool.name === name)!.description!;
      expect(description).toMatch(/deterministic rubric/);
      expect(description).toMatch(/not from an AI model/);
      expect(description).toMatch(/only on the user's own resume/);
      expect(description).toMatch(/Never use it to screen, rank/);
    }
    expect(client.getInstructions()).toMatch(/own resume/);
  });

  it("check_resume on a PDF with a posting is check() on the same file and posting", async () => {
    const result = await call("check_resume", { path: pdfPath, job_text: JOB });
    expect(result.isError).toBeFalsy();
    const { report } = await pdfReport({ jobDescription: normalizeJobText(JOB) });
    expect(result.structuredContent).toEqual(expectedCheck(report, true));
    expect(report.jobMatchScore).not.toBeNull();
    expect(report.requirements.length).toBeGreaterThan(0);

    const said = textOf(result);
    expect(said).toContain(`Readiness: ${report.readinessScore}/100`);
    expect(said).toContain(`Job match: ${report.jobMatchScore}/100`);
    expect(said).toContain("no AI model produced this score");
    expect(said).toContain("- Name: Jane Doe");
    // The file's name says nothing about whose resume it is: advice, after the failed checks.
    expect(report.advice.map((item) => item.id)).toContain("file.name");
    expect(said.indexOf("Advice (not scored):")).toBeGreaterThan(said.indexOf("Failed checks"));
    expect(said).toContain("Jane-Doe-Resume.pdf");
  }, 60_000);

  it("check_resume adds a named ATS's documented notes, with their sources", async () => {
    const result = await call("check_resume", { text: RESUME.join("\n"), target_ats: "lever" });
    expect(result.isError).toBeFalsy();
    const resume = normalizeExtractedText(RESUME.join("\n"));
    const report = check(resume, POLICY, { targetAts: "lever" });
    expect(result.structuredContent).toEqual(expectedCheck(report, false));
    const notes = report.advice.filter((item) => item.kind === "ats");
    expect(notes.length).toBeGreaterThan(0);
    for (const note of notes) expect(textOf(result)).toContain(note.source!);
  });

  it("check_resume on text is check() on the same text, with no job", async () => {
    const result = await call("check_resume", { text: RESUME.join("\n"), region: "US" });
    expect(result.isError).toBeFalsy();
    const report = check(normalizeExtractedText(RESUME.join("\n")), POLICY, { region: "US" });
    expect(result.structuredContent).toEqual(expectedCheck(report, false));
    expect(result.structuredContent!.job).toBeNull();
  });

  it("reads in the language a call names, as check() does, and refuses one no pack has", async () => {
    const german = LOCALE_FIXTURES.de[0]!.text;
    const detected = await call("check_resume", { text: german });
    expect(detected.structuredContent).toMatchObject({
      locale: { languages: ["de"], region: "DE" },
    });
    const english = await call("check_resume", { text: german, language: "EN" });
    expect(english.structuredContent).toEqual(
      expectedCheck(check(normalizeExtractedText(german), POLICY, { languages: ["en"] }), false),
    );
    expect(english.structuredContent).toMatchObject({ locale: { languages: [] } });
    const unknown = await call("check_resume", { text: german, language: "xx" });
    expect(unknown.isError).toBe(true);
    expect(textOf(unknown)).toContain('Unknown language "xx"; use one of en, de, fr, hi, es, pt.');
  });

  it("says when the resume is in a language it does not read yet", async () => {
    const result = await call("check_resume", { text: ITALIAN_RESUME });
    expect(result.structuredContent).toMatchObject({ locale: { unsupported: "it" } });
    expect(textOf(result)).toContain(
      "Language: This resume looks Italian, which the engine does not read yet",
    );
  });

  it("match_job returns only the match, the requirements and the missing keywords", async () => {
    const result = await call("match_job", { text: RESUME.join("\n"), job_path: jobPath });
    expect(result.isError).toBeFalsy();
    const report = check(normalizeExtractedText(RESUME.join("\n")), POLICY, {
      jobDescription: normalizeJobText(JOB),
    });
    expect(result.structuredContent).toEqual(
      JSON.parse(
        JSON.stringify({
          jobMatchScore: report.jobMatchScore,
          requirements: report.requirements,
          missingKeywords: report.missingKeywords,
          missingKeywordGroups: report.missingKeywordGroups,
        }),
      ),
    );
    expect(textOf(result)).toContain(`Job match: ${report.jobMatchScore}/100`);
    expect(report.missingKeywordGroups.soft).toEqual(["communication", "teamwork"]);
    expect(textOf(result)).toContain("Missing soft skills (weigh less): communication, teamwork");
  });

  it("extract_text gives the PDF's text in reading order and its measured layout", async () => {
    const result = await call("extract_text", { path: pdfPath });
    expect(result.isError).toBeFalsy();
    const { report, layout } = await pdfReport({ includeLines: true });
    // All of the layout but `hiddenTextRead`, which on a PDF repeats `hiddenText` for the model.
    const { hiddenTextRead, ...measured } = layout!;
    expect(hiddenTextRead).toBe(layout!.hiddenText);
    expect(result.structuredContent).toEqual(
      JSON.parse(
        JSON.stringify({
          lines: report.lines,
          wordCount: report.wordCount,
          parsingWarnings: report.parsingWarnings,
          layout: measured,
        }),
      ),
    );
    expect(report.lines!.slice(0, 2)).toEqual(RESUME.slice(0, 2));
    expect(textOf(result)).toContain("Jane Doe\njane.doe@example.com");
  }, 60_000);

  it("extract_text on text has no layout to report", async () => {
    const result = await call("extract_text", { text: RESUME.join("\n") });
    expect(result.structuredContent!.layout).toBeNull();
  });

  it("explain_rule gives the rubric's entry for a rule", async () => {
    const entry = policyRubric(DEFAULT_POLICY)[0]!;
    const result = await call("explain_rule", { rule_id: entry.id });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(JSON.parse(JSON.stringify(entry)));
    expect(textOf(result)).toContain(`Fix: ${entry.fix}`);
  });

  it("explain_rule weighs a rule as the region asked for does", async () => {
    const id = "ats-v2.format.photo";
    const us = await call("explain_rule", { rule_id: id, region: "us" });
    expect(us.isError).toBeFalsy();
    expect(us.structuredContent).toMatchObject({ id, points: 6, severity: "warning" });
    const de = await call("explain_rule", { rule_id: id, region: "DE" });
    expect(de.isError).toBe(true);
    expect(textOf(de)).toMatch(/not scored in DE/);
    const unknown = await call("explain_rule", { rule_id: id, region: "XX" });
    expect(textOf(unknown)).toMatch(/Unknown region "XX"/);
  });

  it("publishes the rubric as rubric://default", async () => {
    const { resources } = await client.listResources();
    expect(resources.map((resource) => resource.uri)).toEqual(["rubric://default"]);
    const { contents } = await client.readResource({ uri: "rubric://default" });
    const rubric = JSON.parse((contents[0] as { text: string }).text);
    expect(contents[0]!.mimeType).toBe("application/json");
    expect(rubric.rules).toEqual(JSON.parse(JSON.stringify(policyRubric(DEFAULT_POLICY))));
    expect(rubric.policy).toBe(DEFAULT_POLICY.version);
  });
});

describe("ats-engine-mcp refuses a bad call with a tool error", () => {
  it.each([
    ["a folder", { path: join(dir, "folder.pdf") }, /is a folder, not a file/],
    ["a missing file", { path: join(dir, "missing.pdf") }, /No such file: /],
    ["an unsupported type", { path: join(dir, "resume.rtf") }, /Unsupported resume file type/],
    // Read in the extraction process, whose answer comes back as the reason.
    ["a damaged PDF", { path: damagedPath }, /could not be read as a PDF; it may be damaged/],
    ["both path and text", { path: pdfPath, text: RESUME.join("\n") }, /path or as text, not both/],
    ["neither path nor text", {}, /Give the resume: path .* or text/],
    ["text too short to be a resume", { text: "Jane Doe" }, /too short to be a resume/],
    ["both job_path and job_text", { path: pdfPath, job_path: jobPath, job_text: JOB }, /not both/],
    ["a missing job file", { path: pdfPath, job_path: join(dir, "nope.txt") }, /No such file/],
    // Its words would come back as missing keywords: a credentials file is not a posting.
    [
      "a job file that is not a posting",
      { path: pdfPath, job_path: credentialsPath },
      /Unsupported job posting file type "[^"]*credentials"\. Use \.txt, \.md, \.html, \.pdf or \.docx\.$/,
    ],
    ["an unknown region", { path: pdfPath, region: "XX" }, /Unknown region "XX"; use one of US/],
    [
      "an ATS with no notes",
      { path: pdfPath, target_ats: "acme" },
      /Unknown target_ats "acme"; use one of greenhouse, lever, taleo\./,
    ],
  ])("check_resume: %s", async (_, args, message) => {
    const result = await call("check_resume", args);
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(message);
    expect(result.structuredContent).toBeUndefined();
  });

  it("match_job without a posting", async () => {
    const result = await call("match_job", { path: pdfPath });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toMatch(/Give the job posting: job_path or job_text/);
  });

  // On Windows a UNC path is read over SMB: the server makes no network requests.
  it.skipIf(process.platform !== "win32")(
    "match_job with a job file on a network share",
    async () => {
      // A posting's type, so the path's form is what refuses it.
      const job_path = String.raw`\\127.0.0.1\C$\Windows\posting.txt`;
      const result = await call("match_job", { path: pdfPath, job_path });
      expect(result.isError).toBe(true);
      expect(textOf(result)).toMatch(/is a network share or a device, not a file on this computer/);
    },
  );

  it("explain_rule with an unknown id lists the valid ids", async () => {
    const result = await call("explain_rule", { rule_id: "no-such-rule" });
    expect(result.isError).toBe(true);
    const ids = policyRubric(DEFAULT_POLICY).map((rule) => rule.id);
    expect(textOf(result)).toBe(`Unknown rule id "no-such-rule". Valid ids: ${ids.join(", ")}.`);
  });

  it("keeps serving after errors", async () => {
    const result = await call("check_resume", { text: RESUME.join("\n") });
    expect(result.isError).toBeFalsy();
  });
});

describe("registry metadata", () => {
  it("server.json names the package, its version and mcpName", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE, "utf8"));
    const server = JSON.parse(readFileSync(SERVER_JSON, "utf8"));
    expect(server.name).toBe(pkg.mcpName);
    // The registry compares `io.github.<owner>/*` case-sensitively (registry#689).
    expect(server.name).toBe("io.github.VeriWorkly/ats-engine");
    expect(server.version).toBe(pkg.version);
    expect(server.packages).toEqual([
      expect.objectContaining({
        registryType: "npm",
        identifier: pkg.name,
        version: pkg.version,
        transport: { type: "stdio" },
      }),
    ]);
    // The registry's limit.
    expect(server.description.length).toBeLessThanOrEqual(100);
  });
});

describe("certifications and spoken languages", () => {
  it("reads them out in the text and returns them in the structured result", async () => {
    const resume = [
      ...RESUME,
      "",
      "Certifications",
      "AWS Certified Solutions Architect – Associate, Amazon Web Services, 2023",
      "",
      "Languages",
      "English (native), German (B2)",
    ].join("\n");
    const result = await call("check_resume", { text: resume });
    expect(result.isError).toBeFalsy();
    expect(textOf(result)).toContain("- Certification: AWS Certified Solutions Architect");
    expect(textOf(result)).toMatch(/- Speaks: English.*German/);
    const parsed = (result.structuredContent as { parsed: Record<string, unknown[]> }).parsed;
    expect(parsed.certifications).toHaveLength(1);
    expect(parsed.spokenLanguages).toHaveLength(2);
  });
});

// 150 calls at once started 150 children (7.3 GB), and a cancelled call left its child running.
describe("file reading is bounded", () => {
  it("reads at most MAX_READS files at once; the rest wait their turn", async () => {
    const { inTurn, MAX_READS } = await import("../src/inputs.js");
    let running = 0;
    let most = 0;
    const read = async () => {
      most = Math.max(most, (running += 1));
      await new Promise((resolve) => setTimeout(resolve, 5));
      running -= 1;
    };
    await Promise.all(Array.from({ length: MAX_READS * 3 + 1 }, () => inTurn(read)));
    expect(most).toBe(MAX_READS);
  });

  it("never starts a read whose call was cancelled while it waited", async () => {
    const { inTurn, MAX_READS } = await import("../src/inputs.js");
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    const busy = Array.from({ length: MAX_READS }, () => inTurn(() => held));
    const controller = new AbortController();
    let started = false;
    const waiting = inTurn(async () => void (started = true), controller.signal);
    controller.abort();
    await expect(waiting).rejects.toThrow("The call was cancelled.");
    release();
    await Promise.all(busy);
    expect(started).toBe(false);
  });

  it("stops the child reading a file when the call is cancelled", async () => {
    const { extractInChild } = await import("../src/inputs.js");
    const controller = new AbortController();
    const reading = extractInChild(new Uint8Array(pdf), "pdf", controller.signal);
    setTimeout(() => controller.abort(), 20);
    await expect(reading).rejects.toThrow("The call was cancelled.");
  });
});
