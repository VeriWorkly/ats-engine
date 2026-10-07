/**
 * `--ai`: a model's plain-language reading of the report, from a provider the user picks.
 *
 * The API key comes from the environment only, never from a flag, which would leave it in shell
 * history and in the process list. Named providers are presets over the two adapters; anything
 * else that serves Chat Completions is `openai-compatible` with a `--base-url`.
 */

import { anthropic } from "../ai/anthropic.js";
import {
  AtsAiError,
  createAtsAi,
  type AnalyzeInput,
  type AtsAiInsights,
  type AtsAiResult,
} from "../ai/index.js";
import { openAiCompatible } from "../ai/openai-compatible.js";
import type { FetchLike } from "../ai/http.js";
import type { LlmProvider } from "../ai/provider.js";
import type { Env, Style } from "./terminal.js";
import { UsageError } from "./usage.js";

type Preset = {
  adapter: "anthropic" | "openai-compatible";
  baseUrl?: string;
  /** The variable the provider's own tools read the key from. */
  keyEnv?: string;
};

export const PROVIDERS: Readonly<Record<string, Preset>> = {
  anthropic: { adapter: "anthropic", keyEnv: "ANTHROPIC_API_KEY" },
  openai: { adapter: "openai-compatible", keyEnv: "OPENAI_API_KEY" },
  openrouter: {
    adapter: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
  },
  gemini: {
    adapter: "openai-compatible",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    keyEnv: "GEMINI_API_KEY",
  },
  groq: {
    adapter: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
  },
  together: {
    adapter: "openai-compatible",
    baseUrl: "https://api.together.xyz/v1",
    keyEnv: "TOGETHER_API_KEY",
  },
  ollama: { adapter: "openai-compatible", baseUrl: "http://localhost:11434/v1" },
  "openai-compatible": { adapter: "openai-compatible" },
};

export const PROVIDER_NAMES = Object.keys(PROVIDERS);

/** Output budget when none is given. Thinking models spend part of it before they answer. */
export const DEFAULT_MAX_TOKENS = 8_000;

/** The longest the CLI waits for an analysis, retries included, when none is given. A thinking
 * model spending its whole default budget answers well within it. */
export const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_TIMEOUT_SECONDS = 3_600;

export type AiFlags = {
  provider?: string;
  model?: string;
  "base-url"?: string;
  "max-tokens"?: string;
  timeout?: string;
};

export type AiConfig = {
  provider: string;
  adapter: Preset["adapter"];
  model: string;
  baseUrl?: string;
  /** Where the resume goes, as the notice before sending names it. */
  host: string;
  maxTokens: number;
  /** The whole wait for an answer, retries included. */
  timeoutMs: number;
  apiKey: string;
};

/** A server on this machine needs no key; one anywhere else does. */
function isLocal(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

/**
 * Flags win over `ATS_AI_*` variables. Throws a `UsageError` naming what is missing.
 *
 * A provider named by flag ignores `ATS_AI_BASE_URL`: an endpoint left in the environment for
 * another provider would otherwise receive this provider's key. For the same reason the provider's
 * own key variable is read before the shared `ATS_AI_API_KEY`.
 */
export function resolveAiConfig(flags: AiFlags, env: Env): AiConfig {
  const baseUrlOverride =
    flags["base-url"] || (flags.provider ? undefined : env.ATS_AI_BASE_URL) || undefined;
  const provider = (
    flags.provider ||
    env.ATS_AI_PROVIDER ||
    (baseUrlOverride ? "openai-compatible" : "")
  ).toLowerCase();
  if (!provider)
    throw new UsageError(
      `--ai needs a provider: --provider <name> or ATS_AI_PROVIDER. One of: ${PROVIDER_NAMES.join(", ")}.`,
    );
  if (!Object.hasOwn(PROVIDERS, provider))
    throw new UsageError(
      `Unknown provider "${provider}"; use one of ${PROVIDER_NAMES.join(", ")}.`,
    );
  const preset = PROVIDERS[provider]!;

  const baseUrl = baseUrlOverride ?? preset.baseUrl;
  if (provider === "openai-compatible" && !baseUrl)
    throw new UsageError("--provider openai-compatible needs --base-url (or ATS_AI_BASE_URL).");
  if (baseUrl) {
    let protocol: string;
    try {
      protocol = new URL(baseUrl).protocol;
    } catch {
      throw new UsageError(`--base-url "${baseUrl}" is not a URL.`);
    }
    if (protocol !== "https:" && protocol !== "http:")
      throw new UsageError(`--base-url must be an http or https URL, not "${baseUrl}".`);
  }

  const model = flags.model || env.ATS_AI_MODEL;
  if (!model)
    throw new UsageError(
      `--ai needs a model: --model <id> or ATS_AI_MODEL, using an id ${provider} lists.`,
    );

  const budget = flags["max-tokens"] ?? env.ATS_AI_MAX_TOKENS;
  const maxTokens = budget === undefined ? DEFAULT_MAX_TOKENS : Number(budget);
  if (!Number.isInteger(maxTokens) || maxTokens <= 0)
    throw new UsageError("--max-tokens must be a positive whole number.");

  const wait = flags.timeout ?? env.ATS_AI_TIMEOUT;
  const seconds = wait === undefined ? DEFAULT_TIMEOUT_SECONDS : Number(wait);
  if (!(wait?.trim() !== "" && seconds > 0 && seconds <= MAX_TIMEOUT_SECONDS))
    throw new UsageError(
      `--timeout must be a number of seconds, more than 0 and at most ${MAX_TIMEOUT_SECONDS}.`,
    );

  const apiKey =
    (preset.keyEnv ? env[preset.keyEnv] : undefined) || env.ATS_AI_API_KEY || undefined;
  const local = Boolean(baseUrl && isLocal(baseUrl));
  if (!apiKey && !local)
    throw new UsageError(
      `No API key for ${provider}: set ${preset.keyEnv ? `${preset.keyEnv} or ` : ""}ATS_AI_API_KEY. ` +
        "Keys are read from the environment only, never from a flag.",
    );
  if (apiKey && !local && baseUrl && new URL(baseUrl).protocol === "http:")
    throw new UsageError(
      `Refusing to send an API key over plain http to ${new URL(baseUrl).host}. Use an https URL.`,
    );

  return {
    provider,
    adapter: preset.adapter,
    model,
    baseUrl,
    host: new URL(
      baseUrl ??
        (preset.adapter === "anthropic" ? "https://api.anthropic.com" : "https://api.openai.com"),
    ).host,
    maxTokens,
    timeoutMs: seconds * 1000,
    // A local server ignores the key, but the adapter requires one.
    apiKey: apiKey ?? "local",
  };
}

export function createProvider(config: AiConfig, fetch?: FetchLike): LlmProvider {
  const options = {
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
    fetch,
    timeoutMs: config.timeoutMs,
  };
  return config.adapter === "anthropic" ? anthropic(options) : openAiCompatible(options);
}

export async function analyzeReport(
  config: AiConfig,
  input: AnalyzeInput,
  fetch?: FetchLike,
): Promise<AtsAiResult<AtsAiInsights>> {
  const ai = createAtsAi({
    provider: createProvider(config, fetch),
    routes: { analyze: { model: config.model, maxTokens: config.maxTokens, retries: 1 } },
  });
  // One deadline for the whole call: each attempt may use all of it, and a retry only what is
  // left, so a provider that never answers costs `timeoutMs`, not that once per attempt.
  return ai.analyze(input, { signal: AbortSignal.timeout(config.timeoutMs) });
}

/** What went wrong, and what to change. */
export function describeAiError(error: unknown, config: AiConfig): string {
  const where = `${config.provider} (${config.model})`;
  if (!(error instanceof AtsAiError))
    return `AI analysis failed: ${error instanceof Error ? error.message : String(error)}`;
  switch (error.code) {
    case "truncated":
      return `${where} ran out of output tokens. Raise --max-tokens (now ${config.maxTokens}).`;
    case "aborted":
      return (
        `No answer from ${config.provider} at ${config.host} within ${config.timeoutMs / 1000} s. ` +
        "Raise --timeout, or try a faster model."
      );
    case "refused":
      return `${where} declined to analyse this resume.`;
    case "invalid_output":
      return `${where} did not return a usable analysis (${error.message}). Try another model.`;
    case "provider":
      if (error.status === 401 || error.status === 403)
        return `${where} rejected the API key (HTTP ${error.status}). Check the key for ${config.provider}.`;
      if (error.status === 404)
        return `${where} returned HTTP 404. Check the model id${config.baseUrl ? ` and --base-url` : ""}.`;
      return `${where} failed: ${error.message}`;
    default:
      return `AI analysis failed: ${error.message}`;
  }
}

export function renderInsights(
  run: AtsAiResult<AtsAiInsights>,
  config: AiConfig,
  style: Style,
): string {
  const { result } = run;
  const lines = [
    "",
    `${style.bold("AI analysis")} ${style.dim(`(${config.provider}, ${run.model})`)}`,
  ];

  const explanation = result.explanation
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
  if (explanation.length)
    lines.push(
      ...explanation.flatMap((paragraph, i) => (i ? ["", `  ${paragraph}`] : [`  ${paragraph}`])),
    );

  const section = (title: string, items: string[], numbered = false) => {
    if (!items.length) return;
    lines.push("", `  ${style.bold(title)}`);
    items.forEach((item, i) => lines.push(`    ${numbered ? `${i + 1}.` : "-"} ${item}`));
  };
  section("Do first", result.priorityOrder, true);
  section("Improvements", result.recommendedImprovements);
  section("Missing evidence", result.missingEvidence);
  if (result.keywordOpportunities.length)
    lines.push(
      "",
      `  ${style.bold("Keywords to consider")}`,
      `    ${result.keywordOpportunities.join(", ")}`,
    );

  if (lines.length === 2) lines.push("  The model returned no analysis.");

  const notes: string[] = [];
  if (run.rejected.length)
    notes.push(
      `${run.rejected.length} suggestion${run.rejected.length === 1 ? "" : "s"} dropped: not found in the resume or the posting`,
    );
  if (run.usage) notes.push(`${run.usage.inputTokens} tokens in, ${run.usage.outputTokens} out`);
  if (run.attempts > 1) notes.push(`${run.attempts} attempts`);
  lines.push(
    "",
    style.dim(`  AI suggestions are advice; the score above does not depend on them.`),
  );
  if (notes.length) lines.push(style.dim(`  ${notes.join(" · ")}`));
  return lines.join("\n");
}

/** The `ai` member `--json` adds to the report. */
export function aiJson(run: AtsAiResult<AtsAiInsights>, config: AiConfig) {
  return {
    provider: config.provider,
    model: run.model,
    insights: run.result,
    rejected: run.rejected,
    usage: run.usage ?? null,
    attempts: run.attempts,
    promptVersion: run.promptVersion,
  };
}
