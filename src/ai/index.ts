/**
 * @veriworkly/ats-engine/ai — the model-backed tasks, with any provider.
 *
 * Bring a provider (`/ai/openai-compatible`, `/ai/anthropic`, or your own `LlmProvider`) and a
 * model per task. Each task returns its result with token usage, attempts and the prompt
 * version. Output is schema-validated and every value claiming to come from the input is
 * checked against it.
 */

import { DEFAULT_POLICY } from "../policy/default.js";
import type { AtsEnginePolicy } from "../policy/schema.js";
import type { AtsParsedResume } from "../types.js";
import type { LlmProvider } from "./provider.js";
import {
  runTask,
  type AtsAiCallOptions,
  type AtsAiResult,
  type AtsAiRetryEvent,
  type AtsAiTask,
  type RouteSettings,
} from "./run.js";
import { analyzeSpec, type AnalyzeInput, type AtsAiInsights } from "./tasks/analyze.js";
import {
  convertResumeSpec,
  type AtsConvertedResume,
  type ConvertResumeInput,
} from "./tasks/convertResume.js";
import { repairParseSpec, type RepairParseInput } from "./tasks/repairParse.js";

/** The provider, and per task the default route, system prompt and redaction. */
export type AtsAiOptions = {
  provider: LlmProvider;
  /** Default model and settings per task. Each call can override any of them. */
  routes?: { [Task in AtsAiTask]?: RouteSettings | undefined } | undefined;
  /** System prompt overrides per task. */
  prompts?: { [Task in AtsAiTask]?: string | undefined } | undefined;
  /** Contact-detail redaction. On by default for `analyze`; `repairParse` and `convertResume` ignore it. */
  redact?: { analyze?: boolean | undefined } | undefined;
  /** Engine policy used to classify repaired credentials. Defaults to `DEFAULT_POLICY`. */
  enginePolicy?: AtsEnginePolicy | undefined;
  hooks?: { onRetry?: { method(event: AtsAiRetryEvent): void }["method"] | undefined } | undefined;
};

/** The three tasks, bound to one provider. Each call can override its task's route. */
export type AtsAi = {
  /** Plain-language explanation and recommendations for a deterministic report. */
  analyze(input: AnalyzeInput, options?: AtsAiCallOptions): Promise<AtsAiResult<AtsAiInsights>>;
  /** Fills the gaps in a failed parse with values grounded in the source. */
  repairParse(
    input: RepairParseInput,
    options?: AtsAiCallOptions,
  ): Promise<AtsAiResult<AtsParsedResume>>;
  /** Converts free text into a structured resume. */
  convertResume(
    input: ConvertResumeInput,
    options?: AtsAiCallOptions,
  ): Promise<AtsAiResult<AtsConvertedResume>>;
};

/**
 * The AI tasks over one provider, with a route (model, budget, retries) per task. Nothing is
 * sent until a task is called.
 */
export function createAtsAi(options: AtsAiOptions): AtsAi {
  const context = {
    provider: options.provider,
    routes: options.routes ?? {},
    prompts: options.prompts ?? {},
    onRetry: options.hooks?.onRetry,
  };
  const redactAnalysis = options.redact?.analyze ?? true;
  const enginePolicy = options.enginePolicy ?? DEFAULT_POLICY;

  return {
    analyze: (input, call = {}) => runTask(context, analyzeSpec(input, redactAnalysis), call),
    repairParse: (input, call = {}) => runTask(context, repairParseSpec(input, enginePolicy), call),
    convertResume: (input, call = {}) =>
      runTask(context, convertResumeSpec(input, enginePolicy), call),
  };
}

export {
  AtsAiError,
  type AtsAiCallOptions,
  type AtsAiErrorCode,
  type AtsAiResult,
  type AtsAiRetryEvent,
  type AtsAiTask,
  type TaskRoute,
} from "./run.js";
export {
  LlmProviderError,
  type LlmMessage,
  type LlmOutputFormat,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
  type LlmUsage,
} from "./provider.js";
export type { AbortSignalLike, FetchLike, FetchResponseLike, HttpOptions } from "./http.js";
export { DEFAULT_ANALYZE_PROMPT, type AnalyzeInput, type AtsAiInsights } from "./tasks/analyze.js";
export { DEFAULT_REPAIR_PROMPT, type RepairParseInput } from "./tasks/repairParse.js";
export {
  CONVERT_GROUNDING_SKIP,
  convertedToDocument,
  groundedText,
  DEFAULT_CONVERT_PROMPT,
  type AtsConvertedResume,
  type ConvertResumeInput,
} from "./tasks/convertResume.js";
