import type * as z from "zod/mini";

import type { GroundingViolation } from "../repair/grounding.js";
import { fnv1a } from "../util/hash.js";
import { ENGLISH_ISSUES } from "../util/issues.js";
import { AbortedError, type AbortSignalLike } from "./http.js";
import {
  isRetryableStatus,
  LlmProviderError,
  type LlmProvider,
  type LlmResponse,
  type LlmUsage,
} from "./provider.js";

/** The model-backed tasks `createAtsAi` runs. */
export type AtsAiTask = "analyze" | "repairParse" | "convertResume";

/** Which model serves a task, and how. Set per task in `createAtsAi`, overridable per call. */
export type TaskRoute = {
  model: string;
  maxTokens: number;
  temperature?: number | undefined;
  /** Extra attempts after the first. A refusal or a 4xx rejection is never retried. */
  retries?: number | undefined;
  /** Ask for `json_schema` output. Off by default: not every model and endpoint supports it. */
  structuredOutputs?: boolean | undefined;
  /** Merged into the request body, e.g. a gateway's routing preferences. */
  providerOptions?: Record<string, unknown> | undefined;
  /** Replaces the task's system prompt for this call. */
  system?: string | undefined;
};

/** A task's route with every setting optional, as `createAtsAi` and a call set it. */
export type RouteSettings = { [Key in keyof TaskRoute]?: TaskRoute[Key] | undefined };

/** One call's overrides of its task's route, and a signal that aborts the call. */
export type AtsAiCallOptions = RouteSettings & { signal?: AbortSignalLike | undefined };

/** What every task returns: its result, the values dropped from it, and what the call cost. */
export type AtsAiResult<T> = {
  result: T;
  /** Values the model returned that were not grounded in the input, and were dropped. */
  rejected: GroundingViolation[];
  /**
   * Summed over every attempt, failed ones included: they were billed too. Undefined when the
   * provider never reported usage — unknown, which is not the same as free.
   */
  usage?: LlmUsage;
  attempts: number;
  /** The provider's id for the response that was used. */
  responseId?: string;
  model: string;
  /** `default:<hash>` or `custom:<hash>` of the system prompt that produced the result. */
  promptVersion: string;
};

/**
 * `truncated`: the reply hit `maxTokens` before it was complete. Not retried — the same budget
 * truncates again and is billed again; raise `maxTokens` instead.
 */
export type AtsAiErrorCode =
  "config" | "provider" | "refused" | "truncated" | "invalid_output" | "aborted";

/**
 * A task that produced no result. `code` says why; `status` is the provider's HTTP status when
 * there was one; `usage` and `attempts` count what was spent before it failed.
 */
export class AtsAiError extends Error {
  readonly code: AtsAiErrorCode;
  readonly status?: number;
  readonly usage?: LlmUsage;
  readonly attempts: number;

  constructor(
    code: AtsAiErrorCode,
    message: string,
    options: {
      status?: number | undefined;
      usage?: LlmUsage | undefined;
      attempts?: number | undefined;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = "AtsAiError";
    this.code = code;
    this.status = options.status;
    this.usage = options.usage;
    this.attempts = options.attempts ?? 0;
  }
}

/** Passed to `hooks.onRetry` before a retry, with the error the failed attempt raised. */
export type AtsAiRetryEvent = { task: AtsAiTask; attempt: number; error: AtsAiError };

export type RunContext = {
  provider: LlmProvider;
  routes: { [Task in AtsAiTask]?: RouteSettings | undefined };
  prompts: { [Task in AtsAiTask]?: string | undefined };
  onRetry?: ((event: AtsAiRetryEvent) => void) | undefined;
};

/** One task's fixed parts. `user` is the already-built user message. */
export type TaskSpec<Raw, Result> = {
  task: AtsAiTask;
  outputName: string;
  schema: z.ZodMiniType<Raw>;
  /**
   * Whether a reply that fits `schema` says anything. Every field is lenient, so a reply in
   * another shape (`{"analysis": {…}}`) fits as an empty one; without this it is a success.
   */
  usable?: (raw: Raw) => boolean;
  /** `schema` as the strict JSON Schema sent to the model. */
  jsonSchema: Record<string, unknown>;
  defaultPrompt: string;
  user: string;
  finish(raw: Raw): { result: Result; rejected: GroundingViolation[] };
};

function resolveRoute(context: RunContext, task: AtsAiTask, options: AtsAiCallOptions) {
  const overrides = Object.fromEntries(
    Object.entries(options).filter(([key, value]) => key !== "signal" && value !== undefined),
  );
  const route = { ...context.routes[task], ...overrides } as Partial<TaskRoute>;
  if (typeof route.model !== "string" || !route.model)
    throw new AtsAiError("config", `No model configured for the "${task}" task.`);
  if (!Number.isInteger(route.maxTokens) || (route.maxTokens ?? 0) <= 0)
    throw new AtsAiError("config", `"${task}" needs a positive integer maxTokens.`);
  const retries = route.retries ?? 0;
  if (!Number.isInteger(retries) || retries < 0 || retries > 5)
    throw new AtsAiError("config", `"${task}" retries must be an integer from 0 to 5.`);
  return { ...route, retries } as TaskRoute & { retries: number };
}

/** The object or array opening at `start`, to its matching close, skipping strings; or null. */
function balancedFrom(text: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let at = start; at < text.length; at += 1) {
    const char = text[at];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === "{" || char === "[") depth += 1;
    else if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) return text.slice(start, at + 1);
    }
  }
  return null;
}

/** How many fences or opening braces are tried as the start of the answer. */
const MAX_CANDIDATES = 20;

/**
 * The JSON in a reply that may wrap it in a fence, in prose, or after `<think>…</think>`
 * reasoning (whose opening tag a chat template may supply). The answer whole if it parses, else
 * the first fenced block or balanced JSON object that parses and `fits`: a reply may show an
 * example before its answer. Failing that, the first that parses, else the reply as it is.
 */
function unfence(text: string, fits: (value: unknown) => boolean): string {
  const close = text.toLowerCase().lastIndexOf("</think>");
  const answer = (close === -1 ? text : text.slice(close + "</think>".length)).trim();
  let first: string | undefined;
  const found = (candidate: string) => {
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch {
      return false;
    }
    first ??= candidate;
    return fits(value);
  };
  // JSON whole is the answer, fitting or not: an object inside it is a part of it.
  if (found(answer) || first) return answer;
  // `indexOf`, not a lazy pattern: unclosed fences made that quadratic.
  for (
    let open = answer.indexOf("```"), fences = 0;
    open !== -1 && fences < MAX_CANDIDATES;
    open = answer.indexOf("```", open + 3), fences += 1
  ) {
    const start = open + 3 + /^[a-z]{0,20}/i.exec(answer.slice(open + 3, open + 23))![0].length;
    const close = answer.indexOf("```", start);
    if (close === -1) break;
    const block = answer.slice(start, close).trim();
    if (/^[[{]/.test(block) && /[\]}]$/.test(block) && found(block)) return block;
  }
  let tried = 0;
  for (
    let at = answer.indexOf("{");
    at !== -1 && tried < MAX_CANDIDATES;
    at = answer.indexOf("{", at + 1), tried += 1
  ) {
    const candidate = balancedFrom(answer, at);
    if (candidate && found(candidate)) return candidate;
  }
  return first ?? answer;
}

/** Parses one response. Throws an `AtsAiError` whose code says whether a retry can help. */
function readReply<Raw>(
  response: LlmResponse,
  schema: z.ZodMiniType<Raw>,
  usable: (raw: Raw) => boolean = () => true,
): Raw {
  if (response.finish === "refusal") throw new AtsAiError("refused", "The model declined.");
  const truncated = response.finish === "length";
  if (!response.text.trim())
    throw truncated
      ? new AtsAiError("truncated", "maxTokens was spent before any output.")
      : new AtsAiError("invalid_output", "Empty response.");

  let json: unknown;
  try {
    json = JSON.parse(
      unfence(response.text, (value) => {
        const fitted = schema.safeParse(value);
        return fitted.success && usable(fitted.data);
      }),
    );
  } catch (error) {
    throw truncated
      ? new AtsAiError("truncated", "Response was cut off at maxTokens.", { cause: error })
      : new AtsAiError("invalid_output", "Response was not valid JSON.", { cause: error });
  }

  const parsed = schema.safeParse(json, ENGLISH_ISSUES);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("; ");
    throw new AtsAiError("invalid_output", `Response did not match the schema: ${issues}`, {
      cause: parsed.error,
    });
  }
  if (!usable(parsed.data))
    throw new AtsAiError("invalid_output", "Response held none of the fields asked for.");
  return parsed.data;
}

/** Normalises anything a provider can throw, and says whether retrying can help. */
function classify(
  error: unknown,
  signal: AbortSignalLike | undefined,
): { error: AtsAiError; retryable: boolean } {
  if (error instanceof AtsAiError) return { error, retryable: error.code === "invalid_output" };
  // The caller's own abort, however a custom provider reported it: never retried.
  if (
    error instanceof AbortedError ||
    signal?.aborted ||
    (error as { name?: unknown })?.name === "AbortError"
  )
    return {
      error: new AtsAiError("aborted", "The request was aborted.", { cause: error }),
      retryable: false,
    };
  const status =
    error instanceof LlmProviderError ? error.status : (error as { status?: unknown })?.status;
  const retryable =
    error instanceof LlmProviderError
      ? error.retryable
      : typeof status !== "number" || isRetryableStatus(status);
  const message = error instanceof Error ? error.message : "Provider call failed.";
  return {
    error: new AtsAiError("provider", message, {
      status: typeof status === "number" ? status : undefined,
      cause: error,
    }),
    retryable,
  };
}

/**
 * Runs one task: build the request, call the provider, validate, retry what a retry can fix.
 * Retried up to `retries` times: malformed or empty output, rate limits, server faults and
 * timeouts. Not retried: refusals, truncation at `maxTokens`, 4xx other than 429, the caller's abort.
 */
export async function runTask<Raw, Result>(
  context: RunContext,
  spec: TaskSpec<Raw, Result>,
  options: AtsAiCallOptions,
): Promise<AtsAiResult<Result>> {
  const route = resolveRoute(context, spec.task, options);
  const system = route.system ?? context.prompts[spec.task] ?? spec.defaultPrompt;
  const promptVersion = `${system === spec.defaultPrompt ? "default" : "custom"}:${fnv1a(system)}`;
  const request = {
    model: route.model,
    system,
    messages: [{ role: "user" as const, content: spec.user }],
    maxTokens: route.maxTokens,
    temperature: route.temperature,
    output: {
      name: spec.outputName,
      schema: spec.jsonSchema,
      mode: route.structuredOutputs ? ("json_schema" as const) : ("json_object" as const),
    },
    extraBody: route.providerOptions,
    signal: options.signal,
  };

  const total: LlmUsage = { inputTokens: 0, outputTokens: 0 };
  let reported = false;
  const usage = () => (reported ? { ...total } : undefined);
  for (let attempt = 1; ; attempt += 1) {
    let raw: Raw;
    let response: LlmResponse;
    try {
      response = await context.provider.complete(request);
      if (response.usage) {
        reported = true;
        for (const key of Object.keys(response.usage) as Array<keyof LlmUsage>)
          total[key] = (total[key] ?? 0) + (response.usage[key] ?? 0);
      }
      raw = readReply(response, spec.schema, spec.usable);
    } catch (thrown) {
      const { error, retryable } = classify(thrown, options.signal);
      if (retryable && attempt <= route.retries) {
        context.onRetry?.({ task: spec.task, attempt, error });
        continue;
      }
      throw new AtsAiError(error.code, error.message, {
        status: error.status,
        usage: usage(),
        attempts: attempt,
        cause: error.cause,
      });
    }

    const { result, rejected } = spec.finish(raw);
    return {
      result,
      rejected,
      usage: usage(),
      attempts: attempt,
      responseId: response.id,
      model: route.model,
      promptVersion,
    };
  }
}
