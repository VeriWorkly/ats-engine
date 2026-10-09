import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

/**
 * The GitHub Action in action/: it runs the CLI, writes the step outputs and the job summary,
 * and fails the step below min-score. Run here against the local build (ATS_ENGINE_CLI), so it
 * needs `npm run build` first, as the MCP tests do.
 */

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "ats-action-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const resume = join(dir, "resume.md");
writeFileSync(
  resume,
  [
    "# Priya Raman",
    "",
    "priya.raman@example.com | (415) 555-0142 | San Francisco, CA",
    "",
    "## Experience",
    "",
    "**Senior Software Engineer**, Northwind Payments — San Francisco, CA",
    "Mar 2021 – Present",
    "",
    "- Led the move of settlement services to Kubernetes, cutting deploy time from 40 to 6 minutes.",
    "- Designed a ledger API in TypeScript handling 12 million transactions a day.",
    "",
    "## Education",
    "",
    "B.S. Computer Science, University of California, Davis, 2018",
    "",
    "## Skills",
    "",
    "TypeScript, Go, PostgreSQL, Kafka, Kubernetes",
  ].join("\n"),
);
const job = join(dir, "job.txt");
writeFileSync(job, "Backend Engineer\n\nRequirements\n- Kubernetes\n- Terraform | Kafka\n- Go\n");

function action(inputs: Record<string, string>) {
  const output = join(dir, `output-${Math.random()}`);
  const summary = join(dir, `summary-${Math.random()}`);
  writeFileSync(output, "");
  writeFileSync(summary, "");
  const run = spawnSync(process.execPath, [join(root, "action/run.mjs")], {
    encoding: "utf8",
    env: {
      ...process.env,
      ATS_ENGINE_CLI: join(root, "dist/cli/index.js"),
      GITHUB_OUTPUT: output,
      GITHUB_STEP_SUMMARY: summary,
      RUNNER_TEMP: dir,
      NO_COLOR: "1",
      ...inputs,
    },
  });
  const outputs: Record<string, string> = {};
  for (const match of readFileSync(output, "utf8").matchAll(/^(\S+)<<(\S+)\n([\s\S]*?)\n\2$/gm))
    outputs[match[1]!] = match[3]!;
  return { code: run.status, stdout: run.stdout, outputs, summary: readFileSync(summary, "utf8") };
}

describe("the GitHub Action", () => {
  it("writes the score, the job match, the failed checks and the report path", () => {
    const { code, outputs, summary } = action({ ATS_RESUME: resume, ATS_JOB: job });
    expect(code).toBe(0);
    expect(Number(outputs.score)).toBeGreaterThan(0);
    expect(Number(outputs["job-match"])).toBeGreaterThan(0);
    expect(Array.isArray(JSON.parse(outputs["failed-checks"]!))).toBe(true);
    expect(JSON.parse(readFileSync(outputs.report!, "utf8")).readinessScore).toBe(
      Number(outputs.score),
    );
    expect(summary).toContain("## ATS resume check");
    expect(summary).toContain("### Job requirements");
    expect(summary).toContain("No AI model is involved in the score.");
  });

  it("fails the step with exit code 2 below min-score", () => {
    const { code, stdout, outputs } = action({ ATS_RESUME: resume, ATS_MIN_SCORE: "100" });
    expect(Number(outputs.score)).toBeLessThan(100);
    expect(code).toBe(2);
    expect(stdout).toContain("is below min-score 100");
  });

  it("refuses a min-score outside 0-100 and a version that is not one", () => {
    expect(action({ ATS_RESUME: resume, ATS_MIN_SCORE: "abc" }).code).toBe(1);
    expect(action({ ATS_RESUME: resume, ATS_MIN_SCORE: "101" }).code).toBe(1);
    expect(action({ ATS_RESUME: resume, ATS_VERSION: "1.0.0; rm -rf /" }).code).toBe(1);
  });

  it("runs the engine release it ships with unless told otherwise", () => {
    const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    const yml = readFileSync(join(root, "action/action.yml"), "utf8");
    expect(yml).toMatch(new RegExp(`\\n  version:\\n(?: {4}.*\\n)*? {4}default: "${version}"`));
  });
});

describe("the job summary", () => {
  it("escapes Markdown a resume's text carries, so the table stays a table", () => {
    const odd = join(dir, "odd.txt");
    writeFileSync(
      odd,
      "Jane | Doe\njane@example.com\n\nExperience\nEngineer, Acme_Corp\nJan 2020 - Present\n- Built *things*.\n",
    );
    const { summary } = action({ ATS_RESUME: odd });
    expect(summary).not.toContain("${c}");
  });
});
