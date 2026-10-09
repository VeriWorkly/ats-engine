// The built MCP server, spawned over stdio and driven with the SDK's own client: every tool's
// structured answer is the engine's `check` on the same input, and every mistake in a call is a
// tool error the assistant can read, not a crash.
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
mkdirSync(join(dir, "folder.pdf"));

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
    expect(result.structuredContent).toEqual(
      JSON.parse(
        JSON.stringify({
          lines: report.lines,
          wordCount: report.wordCount,
          parsingWarnings: report.parsingWarnings,
          layout,
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
    ["both path and text", { path: pdfPath, text: RESUME.join("\n") }, /path or as text, not both/],
    ["neither path nor text", {}, /Give the resume: path .* or text/],
    ["text too short to be a resume", { text: "Jane Doe" }, /too short to be a resume/],
    ["both job_path and job_text", { path: pdfPath, job_path: jobPath, job_text: JOB }, /not both/],
    ["a missing job file", { path: pdfPath, job_path: join(dir, "nope.txt") }, /No such file/],
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
    expect(server.name).toBe("io.github.veriworkly/ats-engine");
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
