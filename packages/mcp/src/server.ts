/**
 * The ATS Engine as MCP tools. Everything runs in this process: no network, no model. The
 * assistant calling these tools is the model; the score is the published rubric's.
 */

import { readFileSync } from "node:fs";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import {
  check,
  computeVerdict,
  DEFAULT_POLICY,
  ENGINE_VERSION,
  policyFingerprint,
  policyRubric,
  type AtsReport,
} from "@veriworkly/ats-engine";
import { printable } from "@veriworkly/ats-engine/format";
import { z } from "zod";

import {
  checkRegion,
  checkTarget,
  isUserError,
  MAX_TEXT_CHARS,
  POLICY,
  readJob,
  readResume,
  REGIONS,
  TARGETS,
  ToolInputError,
  type JobArgs,
  type ResumeArgs,
} from "./inputs.js";
import { provenance, renderCheck, renderJobMatch, renderRule } from "./render.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const DETERMINISTIC =
  "The score comes from a published, deterministic rubric (the same file always gets the same " +
  "score), not from an AI model; present it as the rubric's result, not your own judgement.";

const INTENDED_USE =
  "Use it only on the user's own resume, at their request: it is a tool for candidates. Never " +
  "use it to screen, rank, compare or reject other people.";

const LOCAL = "Runs locally and reads only the files named in the call; nothing is sent anywhere.";

// Inputs ---------------------------------------------------------------------------------------

const resumeInput = {
  path: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Absolute path to the user's resume: .pdf, .docx, .html, .txt, .md, or a .json JSON Resume " +
        "or ats-resume document. Give path or text, not both.",
    ),
  text: z
    .string()
    .min(1)
    .max(MAX_TEXT_CHARS)
    .optional()
    .describe("The resume as plain text, when there is no file. Give path or text, not both."),
};

const jobInput = (required: boolean) => {
  const need = required ? "Give job_path or job_text" : "Optional; give job_path or job_text";
  return {
    job_path: z
      .string()
      .min(1)
      .optional()
      .describe(`Path to a job posting: .txt, .md, .pdf, .docx, or a saved .html page. ${need}.`),
    job_text: z
      .string()
      .min(1)
      .max(MAX_TEXT_CHARS)
      .optional()
      .describe(`The job posting as text. ${need}, not both.`),
  };
};

const targetInput = {
  target_ats: z
    .string()
    .optional()
    .describe(
      `The applicant tracking system the user is applying through (${TARGETS.join(", ")}), to ` +
        "add its vendor's documented notes, each with its source. Advice only; never scored.",
    ),
};

const regionInput = {
  region: z
    .string()
    .optional()
    .describe(
      `Read the resume as from this country (${REGIONS.join(", ")}). Default: inferred from it.`,
    ),
};

// Outputs --------------------------------------------------------------------------------------

const severity = z.enum(["info", "warning", "error"]);

const ruleResult = z.looseObject({
  id: z.string(),
  category: z.string(),
  severity,
  passed: z.boolean(),
  evidence: z.string(),
  scoreImpact: z.number(),
  fix: z.string(),
});

const categoryScore = z.looseObject({
  category: z.string(),
  score: z.number(),
  passed: z.number(),
  total: z.number(),
  lost: z.number(),
  possible: z.number(),
});

const requirement = z.looseObject({
  text: z.string(),
  importance: z.enum(["required", "preferred"]),
  kind: z.string(),
  status: z.enum(["met", "partial", "missing", "unverifiable"]),
  terms: z.array(z.looseObject({ term: z.string(), found: z.boolean() })),
  evidence: z.array(z.string()),
  detail: z.string().optional(),
});

const parsedResume = z.looseObject({
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  links: z.array(z.string()),
  roles: z.array(z.looseObject({ title: z.string(), employer: z.string() })),
  education: z.array(z.looseObject({ school: z.string(), credential: z.string() })),
  skills: z.array(z.string()),
  certifications: z.array(
    z
      .looseObject({ name: z.string(), issuer: z.string() })
      .describe("A certification or licence, with when it was earned and when it expires."),
  ),
  spokenLanguages: z.array(
    z
      .looseObject({
        language: z.string(),
        level: z.string(),
        cefr: z.enum(["A1", "A2", "B1", "B2", "C1", "C2"]).nullable(),
      })
      .describe("A language the candidate speaks, with its level as written and on the CEFR."),
  ),
  monthsOfExperience: z.number().nullable(),
});

const keywordGroups = z
  .object({ hard: z.array(z.string()), soft: z.array(z.string()) })
  .describe("The same terms by kind; soft skills weigh less in the match.");

const jobMatchOutput = {
  jobMatchScore: z.number().nullable().describe("0-100, how well the resume meets the posting."),
  requirements: z.array(requirement).describe("Each requirement of the posting, judged."),
  missingKeywords: z.array(z.string()),
  missingKeywordGroups: keywordGroups,
};

const checkOutput = {
  readinessScore: z.number().describe("0-100, how well an ATS reads and ranks the resume."),
  verdict: z.enum(["strong", "needs-work", "weak"]),
  checksPassed: z.number(),
  checksTotal: z.number(),
  wordCount: z.number(),
  categories: z.array(categoryScore),
  failedChecks: z.array(ruleResult).describe("Every failed check, with its evidence and fix."),
  prioritizedFixes: z.array(z.string()),
  parsingWarnings: z.array(z.string()),
  strengths: z.array(z.string()),
  parsed: parsedResume.describe("The fields an ATS would store from this resume."),
  locale: z.object({ languages: z.array(z.string()), region: z.string().nullable() }),
  engine: z.object({ version: z.string(), policy: z.string() }),
  advice: z
    .array(
      z.looseObject({
        id: z.string(),
        kind: z.enum(["file", "age", "ats"]),
        message: z.string(),
        evidence: z.string().optional(),
        fix: z.string().optional(),
        source: z.string().optional(),
      }),
    )
    .describe(
      "Not scored: the file (name, size, password, tracked changes), details that can invite " +
        "age bias where the region calls for it, and a named ATS's documented notes.",
    ),
  job: z
    .object({
      ...jobMatchOutput,
      matchedKeywords: z.array(z.string()),
      matchedKeywordGroups: keywordGroups,
    })
    .nullable()
    .describe("The match against the posting; null when no posting was given."),
};

const rubricEntry = {
  id: z.string(),
  category: z.string(),
  severity,
  measures: z.string(),
  points: z.number(),
  deduction: z.boolean(),
  passes: z.string(),
  fix: z.string(),
};

const extractOutput = {
  lines: z.array(z.string()).describe("The text in the order an ATS reads it. At most 500 lines."),
  wordCount: z.number(),
  parsingWarnings: z.array(z.string()),
  layout: z
    .looseObject({ columnRatio: z.number().nullable(), tableCount: z.number() })
    .nullable()
    .describe("What the file's layout measured (columns, tables, hidden text); null for text."),
};

// The structured content of each tool, from a report ------------------------------------------

export function checkResult(report: AtsReport, withJob: boolean) {
  return {
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
  };
}

// Tools ----------------------------------------------------------------------------------------

type Answer = { text: string; data: Record<string, unknown> };

/**
 * A tool's answer, or its failure as a tool error the assistant can read and act on. A mistake
 * in the call is said plainly; anything else is also logged to stderr (never stdout, which is the
 * protocol's).
 */
async function answer(run: () => Promise<Answer>): Promise<CallToolResult> {
  try {
    const { text, data } = await run();
    return {
      content: [{ type: "text", text: printable(text) }],
      structuredContent: printable(data),
    };
  } catch (error) {
    if (!isUserError(error)) console.error(error);
    const message = error instanceof Error ? error.message : String(error);
    return { isError: true, content: [{ type: "text", text: printable(message) }] };
  }
}

async function score(
  args: ResumeArgs & JobArgs & { region?: string; target_ats?: string },
  includeLines = false,
) {
  checkRegion(args.region);
  checkTarget(args.target_ats);
  const { input, layout, file } = await readResume(args);
  const job = await readJob(args);
  const jobDescription = job?.text;
  const report = check(input, POLICY, {
    jobDescription,
    jobCompany: job?.company,
    layout,
    file,
    targetAts: args.target_ats,
    region: args.region,
    includeLines,
  });
  return { report, layout, withJob: jobDescription !== undefined };
}

const READ_ONLY = { readOnlyHint: true, idempotentHint: true, openWorldHint: false } as const;

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "ats-engine", title: "ATS Engine", version },
    {
      instructions:
        "Tools for a candidate checking their own resume: read it the way an applicant tracking " +
        `system does, score it, match it to a posting, and explain each rule. ${DETERMINISTIC} ` +
        `${INTENDED_USE} ${LOCAL}`,
    },
  );

  server.registerTool(
    "check_resume",
    {
      title: "Check my resume",
      description:
        "Reads the user's resume the way an applicant tracking system (ATS) does and scores it: " +
        "readiness score (0-100), verdict, per-category scores, every failed check with its " +
        "evidence and fix, and the fields an ATS would store (name, contact, roles, education, " +
        "skills). With a job posting it adds the job match score and each requirement judged. " +
        "Advice that is not scored (the file, age signals, a named ATS's documented notes) " +
        `comes apart from the score. ${DETERMINISTIC} ${INTENDED_USE} ${LOCAL}`,
      inputSchema: { ...resumeInput, ...jobInput(false), ...regionInput, ...targetInput },
      outputSchema: checkOutput,
      annotations: { title: "Check my resume", ...READ_ONLY },
    },
    (args) =>
      answer(async () => {
        const { report, withJob } = await score(args);
        const result = checkResult(report, withJob);
        return { text: renderCheck(report, result.verdict, withJob), data: result };
      }),
  );

  server.registerTool(
    "match_job",
    {
      title: "Match my resume to a job",
      description:
        "Matches the user's resume against one job posting: the job match score (0-100), each " +
        "requirement of the posting judged met, partial, missing or unverifiable with the " +
        `resume's own words as evidence, and the posting's keywords the resume lacks. ` +
        `${DETERMINISTIC} ${INTENDED_USE} ${LOCAL}`,
      inputSchema: { ...resumeInput, ...jobInput(true), ...regionInput },
      outputSchema: jobMatchOutput,
      annotations: { title: "Match my resume to a job", ...READ_ONLY },
    },
    (args) =>
      answer(async () => {
        if (args.job_path === undefined && args.job_text === undefined)
          throw new ToolInputError("Give the job posting: job_path or job_text.");
        const { report } = await score(args);
        return {
          text: [provenance(report), "", ...renderJobMatch(report)].join("\n"),
          data: {
            jobMatchScore: report.jobMatchScore,
            requirements: report.requirements,
            missingKeywords: report.missingKeywords,
            missingKeywordGroups: report.missingKeywordGroups,
          },
        };
      }),
  );

  const rubric = policyRubric(DEFAULT_POLICY);
  server.registerTool(
    "explain_rule",
    {
      title: "Explain a rubric rule",
      description:
        "Explains one rule of the published rubric by its id (as in a failed check's id): its " +
        "category, severity, what it checks, how many points it is worth, and how to fix it. " +
        "The full rubric is the resource rubric://default.",
      inputSchema: { rule_id: z.string().min(1).describe("A rule id, e.g. from failedChecks.") },
      outputSchema: rubricEntry,
      annotations: { title: "Explain a rubric rule", ...READ_ONLY },
    },
    ({ rule_id }) =>
      answer(async () => {
        const entry = rubric.find((rule) => rule.id === rule_id);
        if (!entry)
          throw new ToolInputError(
            `Unknown rule id "${rule_id}". Valid ids: ${rubric.map((rule) => rule.id).join(", ")}.`,
          );
        return { text: renderRule(entry), data: entry };
      }),
  );

  server.registerTool(
    "extract_text",
    {
      title: "Show my resume as an ATS reads it",
      description:
        "The user's resume text in the order an ATS reads it, line by line — after columns are " +
        "untangled and wrapped lines rejoined — with what the layout measured (columns, tables, " +
        "hidden text) and the parsing warnings. For answering 'why did it read my resume like " +
        `this?'. ${INTENDED_USE} ${LOCAL}`,
      inputSchema: { ...resumeInput, ...regionInput },
      outputSchema: extractOutput,
      annotations: { title: "Show my resume as an ATS reads it", ...READ_ONLY },
    },
    (args) =>
      answer(async () => {
        const { report, layout } = await score(args, true);
        const lines = report.lines ?? [];
        const warnings = report.parsingWarnings.map((warning) => `- ${warning}`);
        return {
          text: [
            `Text as an ATS reads it (${lines.length} lines):`,
            "",
            ...lines,
            ...(warnings.length ? ["", "Parsing warnings:", ...warnings] : []),
          ].join("\n"),
          data: {
            lines,
            wordCount: report.wordCount,
            parsingWarnings: report.parsingWarnings,
            layout: layout ?? null,
          },
        };
      }),
  );

  server.registerResource(
    "rubric",
    "rubric://default",
    {
      title: "ATS Engine rubric",
      description:
        "Every rule of the bundled community policy: what it checks, what it costs, how to fix it.",
      mimeType: "application/json",
    },
    (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            {
              policy: DEFAULT_POLICY.version,
              fingerprint: policyFingerprint(DEFAULT_POLICY),
              engine: ENGINE_VERSION,
              rules: rubric,
            },
            null,
            2,
          ),
        },
      ],
    }),
  );

  return server;
}
