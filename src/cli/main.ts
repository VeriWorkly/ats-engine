/** `ats-engine check <resume> [options]`; `USAGE` below is the `--help` text, and README.md's option table follows it. */

import { parseArgs } from "node:util";

import type { FetchLike } from "../ai/http.js";
import { redactsName } from "../ai/redact.js";
import { convertedToDocument, groundedText } from "../ai/tasks/convertResume.js";
import {
  adviceLabel,
  categoryLabel,
  formatCertification,
  formatRoleDates,
  formatSpokenLanguage,
  formatTenure,
  scoreTone,
} from "../format/index.js";
import {
  check,
  computeVerdict,
  DEFAULT_POLICY,
  parseAtsPolicy,
  prepareResume,
  type AtsReport,
  type AtsRequirement,
  type AtsSeverity,
} from "../index.js";
import { BUILT_IN_LOCALES, withLocales } from "../locales/index.js";
import { unsupportedLanguageNote, unsupportedLanguageOpening } from "../locales/languages.js";
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
  readWithAi,
  renderInsights,
  resolveAiConfig,
} from "./ai.js";
import { fetchJob, JobUrlError, locateJob, type FetchJob } from "./jobUrl.js";
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

const KEY_NAMES = Object.values(PROVIDERS)
  .map((preset) => preset.keyEnv)
  .filter(Boolean);
const KEY_VARIABLES = `${KEY_NAMES.slice(0, 3).join(", ")},\n  ${KEY_NAMES.slice(3).join(", ")}`;

const REGIONS = BUILT_IN_LOCALES.regions.map((pack) => pack.id).join(", ");
const LANGUAGES = ["en", ...BUILT_IN_LOCALES.languages.map((pack) => pack.id)].join(", ");
const TARGETS = Object.keys(DEFAULT_POLICY.advice.targets).join(", ");

const USAGE = `Usage: ats-engine check <resume> [options]

Scores a resume (.pdf, .docx, .html, .txt, .md, or a .json resume document).

Options:
  --job <file>        Job posting to match against (.txt, .md, .pdf, .docx, or a saved .html page,
                      whose employer is left out of the keywords)
  --job-url <url>     Job posting on Greenhouse, Lever or Ashby (https only), read from the
                      board's public API; other sites: save the page and use --job. A
                      Greenhouse or Lever posting adds that ATS's notes unless --ats is given
  --policy <file>     Engine policy JSON (default: the bundled default policy)
  --json              Print the full report as JSON, advice included
  --min-score <n>     Exit with code 2 when the readiness score is below n
  --lang <code>       Read the resume in this language (${LANGUAGES}; en: English only);
                      default: detected from the resume
  --region <code>     Read the resume as from this country (${REGIONS}); default: inferred
  --text              Also print the text as an ATS reads it, line by line (with --json,
                      as the report's "lines")
  --ats <name>        Add the documented notes on one ATS (${TARGETS}),
                      each with its source; advice only, the score does not change
  -h, --help          Show this help
  -v, --version       Print the engine version (ats-engine --version)

The report ends with advice that is never scored: the file's name and size, an encrypted PDF,
tracked changes or comments in a Word file, and details that can invite age bias (US resumes).

AI analysis (optional, with your own API key):
  --ai                Ask a model to explain the report and suggest improvements. A resume
                      in a language no pack reads (Italian, Dutch, Russian…) is first read
                      by the model, contact details included; each name, employer, title,
                      school, skill, link and bullet must appear in the file, and what
                      does is scored ("Read with AI help")
  --provider <name>   ${Object.keys(PROVIDERS).slice(0, -1).join(", ")},
                      or openai-compatible with --base-url
  --model <id>        A model id your provider lists
  --base-url <url>    Use a different API endpoint for the provider
  --max-tokens <n>    Output budget, thinking included (default ${DEFAULT_MAX_TOKENS})
  --timeout <s>       Longest wait for the answer in seconds, retries included
                      (default ${DEFAULT_TIMEOUT_SECONDS})

  The key is read from the environment only: the provider's own variable
  (${KEY_VARIABLES}), then ATS_AI_API_KEY.
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
  /** For `--job-url`'s job board APIs; defaults to the global `fetch`. */
  fetchJob?: FetchJob;
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
  const language = report.locale.unsupported && unsupportedLanguageNote(report.locale.unsupported);

  const readiness = toned(report.readinessScore);
  const lines = [
    `${style.bold("Readiness")}  ${readiness.score} (${readiness.label}) — ${report.checksPassed}/${report.checksTotal} checks passed`,
  ];
  if (report.jobMatchScore !== null) {
    lines.push(`${style.bold("Job match")}  ${toned(report.jobMatchScore).score}`);
    const verdict = computeVerdict(report);
    const paint = { strong: style.green, "needs-work": style.yellow, weak: style.red }[verdict];
    lines.push(`${style.bold("Verdict")}    ${paint(verdict.replace("-", " "))}`);
    if (report.requirements.length) {
      const met = report.requirements.filter((requirement) => requirement.status === "met").length;
      lines.push(`  Requirements met: ${met} of ${report.requirements.length}`);
      for (const requirement of report.requirements)
        lines.push(renderRequirement(requirement, style));
    }
    const { hard, soft } = report.missingKeywordGroups;
    if (hard.length) lines.push(`  Missing keywords: ${style.yellow(hard.join(", "))}`);
    if (soft.length)
      lines.push(`  Missing soft skills (weigh less): ${style.dim(soft.join(", "))}`);
    // A posting cut short; the other warnings are failed checks or the language, printed below.
    for (const warning of report.parsingWarnings)
      if (!report.failedChecks.some((rule) => rule.evidence === warning) && warning !== language)
        lines.push(`  ${style.yellow(warning)}`);
  }

  const read = [...report.locale.languages, report.locale.region].filter(Boolean);
  if (read.length) lines.push(`${style.bold("Read as")}    ${read.join(", ")}`);
  if (language) lines.push(style.yellow(language));

  lines.push("", style.bold("What an ATS reads:"));
  lines.push(field("Name", parsed.name || none));
  lines.push(field("Email", parsed.email || none));
  lines.push(field("Phone", parsed.phone || none));
  for (const role of parsed.roles.slice(0, 8)) {
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

  if (report.advice.length) {
    lines.push("", style.bold("Advice (not scored):"));
    for (const item of report.advice) {
      lines.push(`  ${style.dim(`[${adviceLabel(item.kind)}]`)} ${item.message}`);
      if (item.evidence) lines.push(`      ${style.dim(item.evidence)}`);
      if (item.fix) lines.push(`      ${style.accent("Fix:")} ${item.fix}`);
      if (item.source) lines.push(`      ${style.dim(`Source: ${item.source}`)}`);
    }
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

/** Replaces `parseArgs`' messages, which talk about positional arguments. */
function parseCheckArgs(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        job: { type: "string" },
        "job-url": { type: "string" },
        policy: { type: "string" },
        json: { type: "boolean", default: false },
        "min-score": { type: "string" },
        lang: { type: "string" },
        region: { type: "string" },
        text: { type: "boolean", default: false },
        ats: { type: "string" },
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

async function runCheck(argv: string[], context: CliContext): Promise<number> {
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
  // Before any file is read, so a missing key fails at once.
  const aiConfig = values.ai ? resolveAiConfig(values, context.env) : null;
  if (values.job !== undefined && values["job-url"] !== undefined)
    throw new UsageError("Give either --job or --job-url, not both.");
  const jobUrl = values["job-url"] === undefined ? null : locateJob(values["job-url"]);

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
  // The policy's own language reads with no pack.
  const languages = [policy.text.language, ...policy.locales.languages.map((pack) => pack.id)];
  if (values.lang !== undefined && !languages.includes(values.lang.toLowerCase()))
    throw new UsageError(`Unknown --lang "${values.lang}"; use one of ${languages.join(", ")}.`);
  const targets = Object.keys(policy.advice.targets);
  if (values.ats !== undefined && !targets.includes(values.ats.toLowerCase()))
    throw new UsageError(`Unknown --ats "${values.ats}"; use one of ${targets.join(", ")}.`);
  const targetAts =
    values.ats ?? (jobUrl && targets.includes(jobUrl.board.ats) ? jobUrl.board.ats : undefined);

  if (terminal.interactive && !values.json) console.log(banner(terminal));

  const { input, layout, file } = await readResumeFile(positionals[0]!);
  const job = jobUrl
    ? await fetchJob(jobUrl, context.fetchJob)
    : values.job
      ? await readJobFile(values.job)
      : undefined;
  const jobDescription = job?.text;
  const resume = prepareResume(input);
  const options = {
    jobDescription,
    jobCompany: job?.company,
    layout,
    file,
    targetAts,
    region: values.region,
    languages: values.lang === undefined ? undefined : [values.lang],
    includeLines: values.text,
  };
  let report = check(resume, policy, options);

  // A language no pack reads, with --ai: the model reads the fields, every one checked against the
  // file, and the engine scores them as a structured document ("read with AI help").
  let aiFailed = false;
  let reading: { language: string; rejected: number } | undefined;
  const unsupported = report.locale.unsupported;
  if (aiConfig && unsupported && !resume.document) {
    console.error(
      `\n${unsupportedLanguageOpening(unsupported)} the engine does not read yet. Sending the ` +
        `whole resume, contact details included, to ${aiConfig.provider} at ` +
        `${aiConfig.host} (${aiConfig.model}) to read its fields; each name, employer, title, school ` +
        "and skill it returns must appear in the file.",
    );
    try {
      const run = await readWithAi(aiConfig, resume.text, policy, context.fetch);
      // Bullets and summaries must occur in the file too before they are scored; read as the
      // language detected, so the English writing rules stay off them.
      const grounded = groundedText(run.result, resume.text);
      report = check(convertedToDocument(grounded.resume), policy, {
        ...options,
        layout: undefined,
        languages: [unsupported],
      });
      reading = { language: unsupported, rejected: run.rejected.length + grounded.dropped.length };
    } catch (error) {
      console.error(`ats-engine: ${printable(describeAiError(error, aiConfig))}`);
      aiFailed = true;
    }
  }
  const belowMinimum = minScore !== null && report.readinessScore < minScore;

  // Resume and posting text can carry control characters; none reach the terminal.
  if (!values.json) {
    if (reading)
      console.log(
        style.dim(
          `Read with AI help (${aiConfig!.model}): the fields below come from the model, checked ` +
            `against the file${reading.rejected ? `; ${reading.rejected} value(s) not found in it were dropped` : ""}.`,
        ),
      );
    console.log(render(printable(report), style));
  }

  let ai: ReturnType<typeof aiJson> | undefined;
  if (aiConfig && !aiFailed) {
    // Printed before anything leaves the machine, and promising only what `analyze` will redact
    // (ai/redact.ts): a name or link the parser did not read is sent as written.
    const named = redactsName(report.parsed);
    const linked = report.parsed.links.some((link) => link.trim().length >= 3);
    const hidden = [named && "name", "email", "phone number", linked && "links"].filter(Boolean);
    const unread = [!named && "name", !linked && "links"].filter(Boolean);
    console.error(
      `\nSending the resume to ${aiConfig.provider} at ${aiConfig.host} (${aiConfig.model}) for ` +
        `analysis. Your ${hidden.slice(0, -1).join(", ")} and ${hidden.at(-1)} are replaced ` +
        "with placeholders first" +
        (unread.length
          ? `; the check read no ${unread.join(" or ")}, so any in the file are sent as written.`
          : "."),
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

  // JSON escapes C0 but not C1 controls (U+0080–U+009F), which a terminal can act on.
  if (values.json) {
    const readWithAi = reading && {
      provider: aiConfig!.provider,
      model: aiConfig!.model,
      ...reading,
    };
    const out = { ...report, ...(readWithAi && { readWithAi }), ...(ai && { ai }) };
    console.log(JSON.stringify(printable(out), null, 2));
  } else if (values.text)
    console.log(["", style.bold("Text as read:"), ...printable(report.lines ?? [])].join("\n"));

  if (belowMinimum)
    console.error(`Readiness ${report.readinessScore} is below --min-score ${minScore}.`);
  return belowMinimum ? 2 : aiFailed ? 1 : 0;
}

function printUsage(terminal: Terminal) {
  if (terminal.interactive) console.log(banner(terminal));
  console.log(USAGE);
}

export async function main(argv: string[], context = defaultContext()): Promise<number> {
  const [command, ...rest] = argv;
  try {
    if (command === "check") return await runCheck(rest, context);
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
    const usage =
      error instanceof UsageError || error instanceof AtsFileError || error instanceof JobUrlError;
    if (!usage && context.env.DEBUG) console.error(error);
    return 1;
  }
}
