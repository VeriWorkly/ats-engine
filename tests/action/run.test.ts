import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

describe("the job summary with 0.3 reports", () => {
  it("shows missing hard and soft skills apart, and the advice", () => {
    const posting = join(dir, "soft-job.txt");
    writeFileSync(
      posting,
      "Backend Engineer\n\nRequirements\n- Terraform\n- Strong communication\n- Teamwork\n- Go\n",
    );
    const named = join(dir, "Resume_final_v3 (2).md");
    writeFileSync(named, readFileSync(resume, "utf8"));
    const { code, summary } = action({ ATS_RESUME: named, ATS_JOB: posting });
    expect(code).toBe(0);
    expect(summary).toContain("**Missing keywords:**");
    expect(summary).toMatch(/Missing soft skills \(weigh less\):\*\* .*communication/);
    expect(summary).toContain("### Advice (not scored)");
  });
});

describe("the ats input", () => {
  it("adds the named ATS's documented notes to the advice", () => {
    const { code, summary } = action({ ATS_RESUME: resume, ATS_TARGET: "greenhouse" });
    expect(code).toBe(0);
    expect(summary).toContain("### Advice (not scored)");
  });

  it("fails on an ATS the engine does not know", () => {
    expect(action({ ATS_RESUME: resume, ATS_TARGET: "nonesuch" }).code).toBe(1);
  });
});

describe("the Action's npx run", () => {
  // `npx` installs no optional peers, so the Action asks it for the PDF and DOCX readers next to
  // the engine; without them a PDF resume exits 1. The tests above run the local build and never
  // reach npx, so a preload stands in for spawnSync and records what would be passed to it.
  const preload = join(dir, "preload.mjs");
  const record = join(dir, "argv.json");
  writeFileSync(
    preload,
    `import cp from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { writeFileSync } from "node:fs";
cp.spawnSync = (command, args) => {
  writeFileSync(${JSON.stringify(record)}, JSON.stringify(args));
  return { status: 0, stdout: JSON.stringify({ readinessScore: 90, failedChecks: [] }), stderr: "" };
};
syncBuiltinESMExports();
`,
  );
  const spawned = (env: Record<string, string>) => {
    const run = spawnSync(
      process.execPath,
      ["--import", pathToFileURL(preload).href, join(root, "action/run.mjs")],
      {
        encoding: "utf8",
        env: { ...process.env, ATS_RESUME: "resume.pdf", RUNNER_TEMP: dir, ...env },
      },
    );
    expect(run.status).toBe(0);
    return JSON.parse(readFileSync(record, "utf8")) as string[];
  };
  const { peerDependencies } = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
    peerDependencies: Record<string, string>;
  };

  it("asks npx for the engine and each optional peer, then runs ats-engine check", () => {
    const args = spawned({ ATS_ENGINE_CLI: "", ATS_VERSION: "0.4.0" });
    const packages = args.filter((_, i) => args[i - 1] === "-p");
    expect(packages[0]).toBe("@veriworkly/ats-engine@0.4.0");
    expect(
      packages
        .slice(1)
        .map((spec) => spec.replace(/@[^@]+$/, ""))
        .sort(),
    ).toEqual(Object.keys(peerDependencies).sort());
    expect(args).toContain("--yes");
    expect(args.slice(args.indexOf("ats-engine"), args.indexOf("ats-engine") + 2)).toEqual([
      "ats-engine",
      "check",
    ]);
  });

  it("passes a local build only the CLI's own arguments", () => {
    const args = spawned({ ATS_ENGINE_CLI: join(root, "dist/cli/index.js") });
    expect(args[1]).toBe("check");
    expect(args).not.toContain("-p");
  });

  it("pins peer versions the engine's peerDependencies accept", () => {
    // The ranges are exact ("5.4.296") or caret on a 1.0 or later ("^1.12.0").
    const accepts = (range: string, version: string) => {
      if (!range.startsWith("^")) return version === range;
      const [want, have] = [range.slice(1), version].map((v) => v.split(".").map(Number));
      const [major, ...rest] = have!.map((part, i) => part - want![i]!);
      return major === 0 && (rest.find((difference) => difference !== 0) ?? 0) >= 0;
    };
    const source = readFileSync(join(root, "action/run.mjs"), "utf8");
    const pinned = [...source.matchAll(/"(pdf-parse|pdfjs-dist|mammoth)@(\d+\.\d+\.\d+)"/g)];
    expect(pinned.map(([, name]) => name).sort()).toEqual(Object.keys(peerDependencies).sort());
    for (const [, name, version] of pinned)
      expect(accepts(peerDependencies[name!]!, version!), `${name}@${version}`).toBe(true);
  });
});
