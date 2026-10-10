// Runs the ats-engine CLI on the resume, writes the step outputs and the job summary, and fails
// the step below min-score. No dependencies of its own: Node and npx come with every GitHub
// runner, and npx fetches the engine together with the PDF and DOCX readers (its optional peers).
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const env = process.env;
const resume = env.ATS_RESUME?.trim();
const job = env.ATS_JOB?.trim();
const minScoreText = env.ATS_MIN_SCORE?.trim();
const region = env.ATS_REGION?.trim();
const target = env.ATS_TARGET?.trim();
const version = env.ATS_VERSION?.trim() || "latest";

/**
 * A workflow command's message, encoded as the runner decodes it: a line break in it (from an
 * input or a file name) would otherwise end the command and start another one.
 */
const commandData = (text) =>
  String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");

function fail(message) {
  console.log(`::error::${commandData(message)}`);
  process.exit(1);
}

if (!resume) fail("The resume input is required.");
if (!/^[\w.-]+$/.test(version)) fail(`version "${version}" is not a version or a dist-tag.`);
const minScore = minScoreText ? Number(minScoreText) : null;
if (minScore !== null && !(minScore >= 0 && minScore <= 100))
  fail(`min-score must be a number from 0 to 100, not "${minScoreText}".`);

// The engine's optional peers: npx installs none on its own, and a PDF or DOCX resume needs them.
// Each must satisfy the engine's peerDependencies (tests/action/run.test.ts checks).
const peers = ["pdf-parse@2.4.5", "pdfjs-dist@5.4.296", "mammoth@1.12.0"];
// Absolute, because npx runs outside the repository: see the spawn below.
const cliArgs = ["check", resolve(resume), "--json"];
if (job) cliArgs.push("--job", resolve(job));
if (region) cliArgs.push("--region", region);
if (target) cliArgs.push("--ats", target);
const packages = [`@veriworkly/ats-engine@${version}`, ...peers];
const args = ["--yes", ...packages.flatMap((spec) => ["-p", spec]), "ats-engine", ...cliArgs];

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
const run = spawnSync(command, [...prefix, ...(local ? cliArgs : args)], {
  cwd: env.RUNNER_TEMP || tmpdir(),
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
// The CLI's warnings can quote the resume, and the runner reads a line starting "::" on either
// stream as a workflow command: they are passed on with commands stopped, under a token no
// resume can guess.
if (run.stderr) {
  const token = randomBytes(16).toString("hex");
  process.stderr.write(
    `::stop-commands::${token}\n${run.stderr}${run.stderr.endsWith("\n") ? "" : "\n"}::${token}::\n`,
  );
}
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

/**
 * Text from a resume or a posting, shown as text inside a Markdown table cell: one line, cut to
 * 300 characters (whole characters, before anything is escaped), HTML's own characters encoded so
 * no tag survives, and Markdown's escaped, the backslash first: "\<a" would otherwise leave "\\"
 * and a live "<a". GitHub also links an address written on its own ("https://…", "www.…",
 * "name@host"): every colon, the dot after "www" and every "@" are written as entities, which
 * read the same but start no link.
 */
const cell = (text) =>
  Array.from(String(text ?? "").replace(/[\r\n]+/g, " "))
    .slice(0, 300)
    .join("")
    .replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c])
    .replace(/[\\|`*_~[\]]/g, (c) => "\\" + c)
    .replace(/:/g, "&#58;")
    .replace(/@/g, "&#64;")
    .replace(/(www)\./gi, "$1&#46;");

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
// Grouped when the engine reports groups (0.3 and later), flat otherwise.
const groups = report.missingKeywordGroups;
if (groups) {
  if (groups.hard.length) lines.push(`**Missing keywords:** ${cell(groups.hard.join(", "))}`, "");
  if (groups.soft.length)
    lines.push(`**Missing soft skills (weigh less):** ${cell(groups.soft.join(", "))}`, "");
} else if (report.missingKeywords?.length)
  lines.push(`**Missing keywords:** ${cell(report.missingKeywords.join(", "))}`, "");
// Not scored: the file's name and size, details that can invite age bias, notes on a target ATS.
if (report.advice?.length) {
  lines.push("### Advice (not scored)", "");
  for (const item of report.advice)
    lines.push(`- ${cell(item.message)}${item.fix ? ` ${cell(item.fix)}` : ""}`);
  lines.push("");
}
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
  console.log(
    `::error::${commandData(`Readiness score ${report.readinessScore} is below min-score ${minScore}.`)}`,
  );
  process.exit(2);
}
