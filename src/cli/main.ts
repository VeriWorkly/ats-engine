/**
 * `ats-engine check <resume> [--job <file>] [--policy <file>] [--json] [--min-score <n>] [--ai]`
 *
 * Scores a resume file (PDF, DOCX, text, or a JSON resume document) with the bundled default
 * policy, or with `--policy`. `--min-score` makes it usable as a CI gate: the exit code is 2 when the
 * readiness score falls below it. `--ai` adds a model's analysis with the user's own key; the
 * score never depends on it.
 */

import { parseArgs } from "node:util";

import type { FetchLike } from "../ai/http.js";
import {
  categoryLabel,
  formatCertification,
  formatRoleDates,
  formatSpokenLanguage,
  formatTenure,
  scoreTone,
} from "../format/index.js";
import {
  AtsScoringService,
  computeVerdict,
  DEFAULT_POLICY,
  parseAtsPolicy,
  prepareResume,
  type AtsReport,
  type AtsRequirement,
  type AtsSeverity,
} from "../index.js";
import { BUILT_IN_LOCALES, withLocales } from "../locales/index.js";
import {
  AtsFileError,
  parseJsonFile,
  readFileBytes,
  readJobFile,
  readResumeFile,
} from "../node/files.js";
import { ENGINE_VERSION } from "../version.js";
import {
  aiJson,
  analyzeReport,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TIMEOUT_SECONDS,
  describeAiError,
  PROVIDERS,
  renderInsights,
  resolveAiConfig,
} from "./ai.js";
import {
  banner,
  createStyle,
  detectTerminal,
  printable,
  type Env,
  type Style,
  type Terminal,
} from "./terminal.js";
import { UsageError } from "./usage.js";

const KEY_VARIABLES = Object.values(PROVIDERS)
  .map((preset) => preset.keyEnv)
  .filter(Boolean)
  .join(", ");

const REGIONS = BUILT_IN_LOCALES.regions.map((pack) => pack.id).join(", ");

const USAGE = `Usage: ats-engine check <resume> [options]

Scores a resume (.pdf, .docx, .html, .txt, .md, or a .json resume document).

Options:
  --job <file>        Job posting to match against (.txt, .pdf, .docx, or a saved .html page,
                      whose employer is left out of the keywords)
  --policy <file>     Engine policy JSON (default: the bundled default policy)
  --json              Print the full report as JSON
  --min-score <n>     Exit with code 2 when the readiness score is below n
  --region <code>     Read the resume as from this country (${REGIONS}); default: inferred
  --text              Also print the text as an ATS reads it, line by line
  -h, --help          Show this help
  -v, --version       Print the engine version (ats-engine --version)

AI analysis (optional, with your own API key):
  --ai                Ask a model to explain the report and suggest improvements
  --provider <name>   ${Object.keys(PROVIDERS).slice(0, -1).join(", ")},
                      or openai-compatible with --base-url
  --model <id>        A model id your provider lists
  --base-url <url>    Use a different API endpoint for the provider
  --max-tokens <n>    Output budget, thinking included (default ${DEFAULT_MAX_TOKENS})
  --timeout <s>       Longest wait for the answer in seconds, retries included
                      (default ${DEFAULT_TIMEOUT_SECONDS})

  The key is read from the environment only: ATS_AI_API_KEY, or the provider's own
  variable (${KEY_VARIABLES}).
  Ollama and other servers on localhost need no key. ATS_AI_PROVIDER, ATS_AI_MODEL,
  ATS_AI_BASE_URL, ATS_AI_MAX_TOKENS and ATS_AI_TIMEOUT stand in for the flags.

Exit codes: 0 done, 1 error, 2 below --min-score (even when --ai fails).`;

const AI_FLAGS = ["provider", "model", "base-url", "max-tokens", "timeout"] as const;

/** Where output goes and what the environment says. Tests pass their own. */
export type CliContext = {
  terminal: Terminal;
  env: Env;
  /** For the AI providers; defaults to the global `fetch`. */
  fetch?: FetchLike;
};

function defaultContext(): CliContext {
  return { terminal: detectTerminal(process.stdout, process.env), env: process.env };
}

function render(report: AtsReport, style: Style): string {
  const toned = (score: number) => {
    const tone = scoreTone(score);
    const paint = { good: style.green, warn: style.yellow, bad: style.red }[tone];
    return {
      score: paint(style.bold(`${score}/100`)),
      label: { good: "good", warn: "needs work", bad: "weak" }[tone],
    };
  };
  const severity: Record<AtsSeverity, (text: string) => string> = {
    error: style.red,
    warning: style.yellow,
    info: style.dim,
  };
  const field = (label: string, value: string) => `  ${style.dim(label.padEnd(9))}${value}`;
  const none = style.dim("—");
  const { parsed } = report;

  const readiness = toned(report.readinessScore);
  const lines = [
    `${style.bold("Readiness")}  ${readiness.score} (${readiness.label}) — ${report.checksPassed}/${report.checksTotal} checks passed`,
  ];
  if (report.jobMatchScore !== null) {
    lines.push(`${style.bold("Job match")}  ${toned(report.jobMatchScore).score}`);
    // With a posting the verdict reads the match, so it can differ from the readiness label.
    const verdict = computeVerdict(report);
    const paint = { strong: style.green, "needs-work": style.yellow, weak: style.red }[verdict];
    lines.push(`${style.bold("Verdict")}    ${paint(verdict.replace("-", " "))}`);
    if (report.requirements.length) {
      const met = report.requirements.filter((requirement) => requirement.status === "met").length;
      lines.push(`  Requirements met: ${met} of ${report.requirements.length}`);
      for (const requirement of report.requirements)
        lines.push(renderRequirement(requirement, style));
    }
    if (report.missingKeywords.length)
      lines.push(
        `  Missing keywords: ${style.yellow(report.missingKeywords.slice(0, 15).join(", "))}`,
      );
  }

  const read = [...report.locale.languages, report.locale.region].filter(Boolean);
  if (read.length) lines.push(`${style.bold("Read as")}    ${read.join(", ")}`);

  lines.push("", style.bold("What an ATS reads:"));
  lines.push(field("Name", parsed.name || none));
  lines.push(field("Email", parsed.email || none));
  lines.push(field("Phone", parsed.phone || none));
  for (const role of parsed.roles.slice(0, 8)) {
    // A role read without dates prints none, not "(null)".
    const dates = formatRoleDates(role);
    lines.push(
      field(
        "Role",
        `${[role.title, role.employer].filter(Boolean).join(", ") || none}${dates ? ` (${dates})` : ""}`,
      ),
    );
  }
  if (!parsed.roles.length) lines.push(field("Roles", "none found"));
  if (parsed.monthsOfExperience)
    lines.push(field("Tenure", formatTenure(parsed.monthsOfExperience)));
  if (parsed.skills.length) lines.push(field("Skills", parsed.skills.slice(0, 20).join(", ")));
  for (const row of parsed.certifications.slice(0, 8))
    lines.push(field("Cert", formatCertification(row)));
  if (parsed.spokenLanguages.length)
    lines.push(field("Speaks", parsed.spokenLanguages.map(formatSpokenLanguage).join(", ")));

  if (report.failedChecks.length) {
    lines.push("", style.bold("Failed checks:"));
    for (const rule of report.failedChecks)
      lines.push(
        `  ${severity[rule.severity](`[${rule.severity}]`)} ${categoryLabel(rule.category)}: ${rule.evidence}`,
        `      ${style.accent("Fix:")} ${rule.fix}`,
      );
  }
  return lines.join("\n");
}

function renderRequirement(requirement: AtsRequirement, style: Style): string {
  const paint = {
    met: style.green,
    partial: style.yellow,
    missing: style.red,
    unverifiable: style.dim,
  }[requirement.status];
  const label = paint(`[${requirement.status}]`.padEnd(14));
  const preferred = requirement.importance === "preferred" ? style.dim(" (preferred)") : "";
  const detail =
    requirement.status !== "met" && requirement.detail ? style.dim(` — ${requirement.detail}`) : "";
  return `    ${label} ${requirement.text}${preferred}${detail}`;
}

/** parseArgs' own messages talk about positional arguments; say what went wrong instead. */
function parseCheckArgs(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        job: { type: "string" },
        policy: { type: "string" },
        json: { type: "boolean", default: false },
        "min-score": { type: "string" },
        region: { type: "string" },
        text: { type: "boolean", default: false },
        ai: { type: "boolean", default: false },
        provider: { type: "string" },
        model: { type: "string" },
        "base-url": { type: "string" },
        "max-tokens": { type: "string" },
        timeout: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
        version: { type: "boolean", short: "v", default: false },
      },
    });
  } catch (error) {
    const option = /'(-[^']*)'/.exec((error as Error).message)?.[1];
    const code = (error as { code?: string }).code;
    if (code === "ERR_PARSE_ARGS_UNKNOWN_OPTION")
      throw new UsageError(
        `Unknown option ${option}. Run "ats-engine check --help" for the options.`,
      );
    if (code === "ERR_PARSE_ARGS_INVALID_OPTION_VALUE")
      throw new UsageError(`${option ?? "An option"} needs a value.`);
    throw error;
  }
}

async function check(argv: string[], context: CliContext): Promise<number> {
  const { values, positionals } = parseCheckArgs(argv);
  const { terminal } = context;
  const style = createStyle(values.json ? 1 : terminal.depth);
  if (values.help) {
    printUsage(terminal);
    return 0;
  }
  if (values.version) {
    console.log(ENGINE_VERSION);
    return 0;
  }
  if (positionals.length !== 1) throw new UsageError("Give exactly one resume file.");

  const minScoreText = values["min-score"];
  const minScore = minScoreText === undefined ? null : Number(minScoreText);
  if (
    minScoreText !== undefined &&
    (!/^\d+(?:\.\d+)?$/.test(minScoreText.trim()) || Number(minScoreText) > 100)
  )
    throw new UsageError("--min-score must be a number from 0 to 100.");

  const strayAiFlag = AI_FLAGS.find((flag) => values[flag] !== undefined);
  if (strayAiFlag && !values.ai) throw new UsageError(`--${strayAiFlag} needs --ai.`);
  // Settled before any file is read, so a missing key fails at once rather than after a parse.
  const aiConfig = values.ai ? resolveAiConfig(values, context.env) : null;

  // The bundled language and region packs ride on whichever policy is used.
  const policy = withLocales(
    values.policy
      ? parseAtsPolicy(parseJsonFile(await readFileBytes(values.policy), values.policy))
      : DEFAULT_POLICY,
    BUILT_IN_LOCALES,
  );
  const regions = policy.locales.regions.map((pack) => pack.id);
  if (values.region !== undefined && !regions.includes(values.region.toUpperCase()))
    throw new UsageError(`Unknown --region "${values.region}"; use one of ${regions.join(", ")}.`);

  if (terminal.interactive && !values.json) console.log(banner(terminal));

  const { input, layout } = await readResumeFile(positionals[0]!);
  const job = values.job ? await readJobFile(values.job) : undefined;
  const jobDescription = job?.text;
  const resume = prepareResume(input);
  const report = AtsScoringService.check(resume, policy, {
    jobDescription,
    jobCompany: job?.company,
    layout,
    region: values.region,
    includeLines: values.text,
  });
  const belowMinimum = minScore !== null && report.readinessScore < minScore;

  // Resume and posting text can carry control characters; none reach the terminal.
  if (!values.json) console.log(render(printable(report), style));

  let aiFailed = false;
  let ai: ReturnType<typeof aiJson> | undefined;
  if (aiConfig) {
    // Said before anything leaves the machine, in plain text: stderr can be a file while stdout
    // is a terminal. `analyze` redacts these; see ai/redact.ts.
    console.error(
      `\nSending the resume to ${aiConfig.provider} at ${aiConfig.host} (${aiConfig.model}) for ` +
        "analysis. Your name, email, phone number and links are replaced with placeholders first.",
    );
    try {
      const run = await analyzeReport(
        aiConfig,
        { resumeText: resume.text, report, jobDescription },
        context.fetch,
      );
      if (values.json) ai = aiJson(run, aiConfig);
      else console.log(renderInsights(printable(run), aiConfig, style));
    } catch (error) {
      console.error(`ats-engine: ${printable(describeAiError(error, aiConfig))}`);
      aiFailed = true;
    }
  }

  // JSON escapes C0 controls but not C1 (U+0080–U+009F), which a terminal can still act on.
  if (values.json) console.log(JSON.stringify(printable(ai ? { ...report, ai } : report), null, 2));
  // The reading order, for seeing what a multi-column layout became.
  else if (values.text)
    console.log(["", style.bold("Text as read:"), ...printable(report.lines ?? [])].join("\n"));

  if (belowMinimum)
    console.error(`Readiness ${report.readinessScore} is below --min-score ${minScore}.`);
  // The gate's answer is known whatever happened to the analysis, and CI acts on it.
  return belowMinimum ? 2 : aiFailed ? 1 : 0;
}

function printUsage(terminal: Terminal) {
  if (terminal.interactive) console.log(banner(terminal));
  console.log(USAGE);
}

export async function main(argv: string[], context = defaultContext()): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === "check") return await check(rest, context);
    if (command === "--version" || command === "-v") {
      console.log(ENGINE_VERSION);
      return 0;
    }
    const asked = command === undefined || command === "-h" || command === "--help";
    if (!asked) console.error(`ats-engine: unknown command "${printable(command)}".\n`);
    printUsage(context.terminal);
    return asked ? 0 : 1;
  } catch (error) {
    console.error(
      `ats-engine: ${printable(error instanceof Error ? error.message : String(error))}`,
    );
    const usage = error instanceof UsageError || error instanceof AtsFileError;
    if (!usage && context.env.DEBUG) console.error(error);
    return 1;
  }
}
