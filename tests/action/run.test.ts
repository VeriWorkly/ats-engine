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

describe("text from the resume", () => {
  // A stand-in CLI that prints a report carrying hostile text, and hostile lines on stderr, as a
  // resume or a posting can make the real one do.
  const stub = join(dir, "stub-cli.mjs");
  const hostile = String.raw`\<a href=https://evil.example/apply#\>apply here\</a\>`;
  writeFileSync(
    stub,
    `process.stderr.write("Warning: x\\n::error::injected from stderr\\n::add-mask::x\\n");
process.stdout.write(JSON.stringify({
  readinessScore: 50,
  failedChecks: [
    { id: "a", severity: "error", evidence: ${JSON.stringify(hostile)}, fix: "Jane | Doe *x* & <b>y</b>" },
    { id: "b", severity: "warning", evidence: "x".repeat(299) + "😀😀", fix: "\\r\\n::error::in a cell" },
  ],
  requirements: [{ status: "missing", text: "<img src=x onerror=alert(1)>" }],
}));
`,
  );
  const stubbed = (inputs: Record<string, string> = {}) => {
    const summaryPath = join(dir, `summary-${Math.random()}`);
    writeFileSync(summaryPath, "");
    const run = spawnSync(process.execPath, [join(root, "action/run.mjs")], {
      encoding: "utf8",
      env: {
        ...process.env,
        ATS_RESUME: resume,
        ATS_ENGINE_CLI: stub,
        GITHUB_STEP_SUMMARY: summaryPath,
        GITHUB_OUTPUT: "",
        RUNNER_TEMP: dir,
        ...inputs,
      },
    });
    return { ...run, summary: readFileSync(summaryPath, "utf8") };
  };
  /** The workflow commands a runner would act on: each line that starts one. */
  const commands = (text: string) => text.split(/\r?\n/).filter((line) => line.startsWith("::"));

  it("is shown as text in the job summary, never as HTML or Markdown", () => {
    const { status, summary } = stubbed();
    expect(status).toBe(0);
    // No tag survives: a backslash before "<" no longer leaves the "<" live.
    expect(summary).not.toMatch(/<(?!sub>|\/sub>)/);
    expect(summary).toContain("\\\\&lt;a href=https://evil.example/apply#\\\\&gt;apply here");
    expect(summary).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(summary).toContain("Jane \\| Doe \\*x\\* &amp; &lt;b&gt;y&lt;/b&gt;");
    // Each table row stays one line, and a cut never splits a character in two.
    expect(summary).toContain("|  ::error::in a cell |");
    expect(summary).toContain(`${"x".repeat(299)}😀 |`);
    expect(summary).not.toMatch(
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/,
    );
  });

  it("starts no workflow command from the CLI's stderr", () => {
    const { stderr, stdout } = stubbed();
    const lines = commands(stderr);
    const token = /^::stop-commands::(\w{16,})$/.exec(lines[0] ?? "")?.[1];
    expect(token).toBeTruthy();
    expect(lines).toEqual([
      `::stop-commands::${token}`,
      "::error::injected from stderr",
      "::add-mask::x",
      `::${token}::`,
    ]);
    expect(commands(stdout)).toEqual([]);
  });

  it("starts no workflow command from an input", () => {
    const { status, stdout } = stubbed({ ATS_MIN_SCORE: "abc\n::warning::injected\r%0A" });
    expect(status).toBe(1);
    expect(commands(stdout)).toEqual([
      '::error::min-score must be a number from 0 to 100, not "abc%0A::warning::injected%0D%250A".',
    ]);
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
