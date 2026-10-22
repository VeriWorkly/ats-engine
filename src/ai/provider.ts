/** Just enough of `AbortSignal`: the package compiles without DOM or Node types. */
export type AbortSignalLike = {
  readonly aborted: boolean;
  readonly reason?: unknown;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
};

/** One turn of the conversation sent to the model. */
export type LlmMessage = { role: "user" | "assistant"; content: string };

/**
 * How to ask for JSON. `json_schema` constrains the response to `schema`, but support depends on
 * the model and endpoint. `json_object` asks only for well-formed JSON.
 */
export type LlmOutputFormat = {
  name: string;
  schema: Record<string, unknown>;
  mode: "json_schema" | "json_object";
};

/** One completion request, as a task builds it and an adapter sends it. */
export type LlmRequest = {
  model: string;
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  /** Left out of the request when undefined: some current models reject sampling parameters. */
  temperature?: number;
  output?: LlmOutputFormat;
  /** Merged into the request body as-is. */
  extraBody?: Record<string, unknown>;
  signal?: AbortSignalLike;
};

/**
 * `inputTokens` is every input token. The cache fields say how many of those were read from or
 * written to a prompt cache, which providers price differently; absent when not reported.
 */
export type LlmUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

/** What an adapter reports back: the text, the provider's response id, usage, why it stopped. */
export type LlmResponse = {
  text: string;
  id?: string;
  usage?: LlmUsage;
  /** `length` means the output hit `maxTokens`; `refusal` means the model declined. */
  finish: "stop" | "length" | "refusal" | "other";
};

/**
 * The whole contract a model provider implements: one non-streaming completion that returns
 * text. `openAiCompatible` and `anthropic` implement it; write your own for any other service.
 */
export interface LlmProvider {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/**
 * A failed provider call. `retryable` is false for a rejection on the request's merits (a 4xx
 * other than 429); rate limits, server faults, timeouts and unreadable bodies are retryable.
 * `retryAfterMs` is how long the provider asked to wait (its `retry-after`), when it said.
 */
export class LlmProviderError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    options: {
      status?: number | undefined;
      retryable: boolean;
      retryAfterMs?: number | undefined;
      cause?: unknown;
    },
  ) {
    super(message, { cause: options.cause });
    this.name = "LlmProviderError";
    this.status = options.status;
    this.retryable = options.retryable;
    this.retryAfterMs = options.retryAfterMs;
  }
}

/** The retry rule for an HTTP status, shared by every adapter. */
export function isRetryableStatus(status: number): boolean {
  return !(status >= 400 && status < 500 && status !== 429);
}
