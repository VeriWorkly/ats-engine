// Runs the ats-engine CLI on the resume, writes the step outputs and the job summary, and fails
// the step below min-score. No dependencies: Node and npx come with every GitHub runner.
import { spawnSync } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const env = process.env;
const resume = env.ATS_RESUME?.trim();
const job = env.ATS_JOB?.trim();
const minScoreText = env.ATS_MIN_SCORE?.trim();
const region = env.ATS_REGION?.trim();
const version = env.ATS_VERSION?.trim() || "latest";

function fail(message) {
  console.log(`::error::${message}`);
  process.exit(1);
}

if (!resume) fail("The resume input is required.");
if (!/^[\w.-]+$/.test(version)) fail(`version "${version}" is not a version or a dist-tag.`);
const minScore = minScoreText ? Number(minScoreText) : null;
if (minScore !== null && !(minScore >= 0 && minScore <= 100))
  fail(`min-score must be a number from 0 to 100, not "${minScoreText}".`);

// Absolute, because npx runs outside the repository: see the spawn below.
const args = ["--yes", `@veriworkly/ats-engine@${version}`, "check", resolve(resume), "--json"];
if (job) args.push("--job", resolve(job));
if (region) args.push("--region", region);

// On Windows `npx` is a .cmd file, which only a shell runs, and a shell would split a path with
// spaces: npx's own script is run with this Node instead. ATS_ENGINE_CLI runs a local build of
// the CLI instead of the published one; the engine's own tests use it.
const local = env.ATS_ENGINE_CLI?.trim();
const [command, prefix] = local
  ? [process.execPath, [local]]
  : process.platform === "win32"
    ? [process.execPath, [join(dirname(process.execPath), "node_modules/npm/bin/npx-cli.js")]]
    : ["npx", []];
// Run outside the repository: inside one whose package.json depends on the engine (or is the
// engine), npx runs that local copy instead of the pinned version.
const run = spawnSync(command, [...prefix, ...(local ? args.slice(2) : args)], {
  cwd: env.RUNNER_TEMP || tmpdir(),
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (run.stderr) process.stderr.write(run.stderr);
if (run.error) fail(`Could not run ats-engine: ${run.error.message}`);
if (run.status !== 0) fail(`ats-engine exited with code ${run.status}.`);

let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  fail("ats-engine did not print a JSON report.");
}

const reportPath = join(env.RUNNER_TEMP || ".", "ats-report.json");
writeFileSync(reportPath, JSON.stringify(report, null, 2));

const failed = (report.failedChecks ?? []).map(({ id, severity, evidence, fix }) => ({
  id,
  severity,
  evidence,
  fix,
}));

function output(name, value) {
  if (!env.GITHUB_OUTPUT) return;
  const delimiter = `ATS_${Math.random().toString(36).slice(2)}`;
  appendFileSync(env.GITHUB_OUTPUT, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}
output("score", String(report.readinessScore));
output("job-match", report.jobMatchScore == null ? "" : String(report.jobMatchScore));
output("failed-checks", JSON.stringify(failed));
output("report", reportPath);

/** Text from a resume or a posting, safe inside a Markdown table cell. */
const cell = (text) =>
  String(text ?? "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[|<>`*_[\]]/g, (c) => "\\" + c)
    .slice(0, 300);

const below = minScore !== null && report.readinessScore < minScore;
const lines = [
  "## ATS resume check",
  "",
  `**Readiness: ${report.readinessScore}/100**` +
    (report.jobMatchScore == null ? "" : ` · Job match: ${report.jobMatchScore}/100`) +
    (minScore === null ? "" : ` · Minimum: ${minScore} ${below ? "(below)" : "(met)"}`),
  "",
];
if (failed.length) {
  lines.push("### Failed checks", "", "| Severity | Finding | Fix |", "| --- | --- | --- |");
  for (const check of failed)
    lines.push(`| ${cell(check.severity)} | ${cell(check.evidence)} | ${cell(check.fix)} |`);
  lines.push("");
} else lines.push("Every check passed.", "");
if (report.requirements?.length) {
  lines.push("### Job requirements", "", "| Status | Requirement |", "| --- | --- |");
  for (const requirement of report.requirements)
    lines.push(`| ${cell(requirement.status)} | ${cell(requirement.text)} |`);
  lines.push("");
}
if (report.missingKeywords?.length)
  lines.push(`**Missing keywords:** ${cell(report.missingKeywords.join(", "))}`, "");
lines.push(
  `<sub>Scored by @veriworkly/ats-engine ${cell(report.engine?.version ?? version)} with a deterministic, published rubric. No AI model is involved in the score.</sub>`,
);

if (env.ATS_SUMMARY !== "false" && env.GITHUB_STEP_SUMMARY)
  appendFileSync(env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`);
console.log(
  `Readiness ${report.readinessScore}/100` +
    (report.jobMatchScore == null ? "" : `, job match ${report.jobMatchScore}/100`) +
    `, ${failed.length} failed check(s).`,
);

if (below) {
  console.log(`::error::Readiness score ${report.readinessScore} is below min-score ${minScore}.`);
  process.exit(2);
}
