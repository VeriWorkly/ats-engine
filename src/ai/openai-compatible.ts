/**
 * @veriworkly/ats-engine/ai/openai-compatible — any Chat Completions endpoint, over `fetch`.
 *
 * One HTTP call per `complete()`; never retried here, the task owns retries.
 */

import { own } from "../util/own.js";
import { postJson, type HttpOptions } from "./http.js";
import {
  LlmProviderError,
  type LlmProvider,
  type LlmRequest,
  type LlmResponse,
} from "./provider.js";

/** The key, the endpoint, and the request details some endpoints need. */
export type OpenAiCompatibleOptions = HttpOptions & {
  apiKey: string;
  /** Defaults to `https://api.openai.com/v1`. */
  baseUrl?: string | undefined;
  /**
   * OpenRouter only: with a `json_schema` request, also send `provider.require_parameters` so
   * the gateway routes only to upstreams that honour the schema. Other endpoints reject the field.
   */
  requireParameters?: boolean | undefined;
  /**
   * The name the output budget is sent under. Defaults to `max_completion_tokens` for
   * api.openai.com (which rejects `max_tokens`), else `max_tokens`.
   */
  maxTokensParameter?: "max_tokens" | "max_completion_tokens" | undefined;
};

type ChatCompletion = {
  id?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | Array<{ type?: string; text?: string }> | null;
      refusal?: string | null;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number | null };
  };
};

/** Message content as text: a string, or the text parts of an array; reasoning parts are skipped. */
const contentText = (content: unknown) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((part) =>
            typeof part?.text === "string" &&
            (part.type === undefined || part.type === "text" || part.type === "output_text")
              ? part.text
              : "",
          )
          .join("")
      : "";

const FINISH: Record<string, LlmResponse["finish"]> = {
  stop: "stop",
  length: "length",
  content_filter: "refusal",
};

/** The request body for one call. Exported for tests that pin the wire format. */
export function chatCompletionBody(
  request: LlmRequest,
  requireParameters = false,
  maxTokensParameter: "max_tokens" | "max_completion_tokens" = "max_tokens",
) {
  const { output, extraBody } = request;
  const structured = output?.mode === "json_schema";
  const routing =
    structured && requireParameters
      ? {
          ...extraBody,
          provider: {
            require_parameters: true,
            ...(extraBody?.provider as Record<string, unknown> | undefined),
          },
        }
      : (extraBody ?? {});

  return {
    ...routing,
    model: request.model,
    messages: [{ role: "system", content: request.system }, ...request.messages],
    [maxTokensParameter]: request.maxTokens,
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(output
      ? {
          response_format: structured
            ? {
                type: "json_schema",
                json_schema: { name: output.name, strict: true, schema: output.schema },
              }
            : { type: "json_object" },
        }
      : {}),
    stream: false,
  };
}

/**
 * A provider for any `POST {baseUrl}/chat/completions` service: OpenAI by default, others by
 * `baseUrl`. One HTTP call per `complete()`. Throws `LlmProviderError` without an API key.
 */
export function openAiCompatible(options: OpenAiCompatibleOptions): LlmProvider {
  if (!options.apiKey) throw new LlmProviderError("An API key is required.", { retryable: false });
  const base = (options.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const url = `${base}/chat/completions`;
  const headers = { authorization: `Bearer ${options.apiKey}`, ...options.headers };
  const maxTokensParameter =
    options.maxTokensParameter ??
    (/^https:\/\/api\.openai\.com\//.test(`${base}/`) ? "max_completion_tokens" : "max_tokens");

  return {
    async complete(request) {
      const body = chatCompletionBody(request, options.requireParameters, maxTokensParameter);
      const json = (await postJson(url, headers, body, {
        ...options,
        signal: request.signal,
      })) as ChatCompletion;

      const choice = json.choices?.[0];
      const refused = Boolean(choice?.message?.refusal);
      return {
        text: contentText(choice?.message?.content),
        id: json.id,
        usage: json.usage
          ? {
              inputTokens: json.usage.prompt_tokens ?? 0,
              outputTokens: json.usage.completion_tokens ?? 0,
              ...(typeof json.usage.prompt_tokens_details?.cached_tokens === "number" && {
                cacheReadTokens: json.usage.prompt_tokens_details.cached_tokens,
              }),
            }
          : undefined,
        finish: refused ? "refusal" : (own(FINISH, choice?.finish_reason ?? "") ?? "other"),
      };
    },
  };
}
