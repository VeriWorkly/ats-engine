import http from "node:http";
import type { AddressInfo } from "node:net";

import { describe, expect, it, vi } from "vitest";

import { anthropic, messagesBody } from "../../src/ai/anthropic.js";
import type { FetchLike } from "../../src/ai/http.js";
import { chatCompletionBody, openAiCompatible } from "../../src/ai/openai-compatible.js";
import { LlmProviderError, type LlmRequest } from "../../src/ai/provider.js";

const schema = {
  type: "object",
  properties: {
    name: { type: ["string", "null"] },
    tags: { type: ["array", "null"], items: { type: "string" } },
  },
  required: ["name", "tags"],
  additionalProperties: false,
};

const request = (overrides: Partial<LlmRequest> = {}): LlmRequest => ({
  model: "m",
  system: "sys",
  messages: [{ role: "user", content: "hi" }],
  maxTokens: 100,
  output: { name: "out", schema, mode: "json_schema" },
  ...overrides,
});

function fetchReturning(status: number, body: unknown) {
  return vi.fn<FetchLike>(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  }));
}

const sentBody = (fetch: ReturnType<typeof fetchReturning>) =>
  JSON.parse(fetch.mock.calls[0]![1].body) as Record<string, unknown>;

describe("openai-compatible request body", () => {
  it("asks for a strict json_schema, puts the system prompt first, and never streams", () => {
    expect(chatCompletionBody(request({ temperature: 0.3 }))).toEqual({
      model: "m",
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "hi" },
      ],
      max_tokens: 100,
      temperature: 0.3,
      response_format: {
        type: "json_schema",
        json_schema: { name: "out", strict: true, schema },
      },
      stream: false,
    });
  });

  it("falls back to json_object and leaves temperature out when unset", () => {
    const body = chatCompletionBody(
      request({ output: { name: "out", schema, mode: "json_object" } }),
    );
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body).not.toHaveProperty("temperature");
  });

  it("adds OpenRouter's require_parameters only when asked, alongside existing routing", () => {
    const extraBody = { provider: { order: ["x"] }, transforms: ["middle-out"] };
    expect(chatCompletionBody(request({ extraBody }))).toMatchObject({
      provider: { order: ["x"] },
    });
    expect(chatCompletionBody(request({ extraBody }), true)).toMatchObject({
      provider: { require_parameters: true, order: ["x"] },
      transforms: ["middle-out"],
    });
    // json_object requests need no schema-honouring upstream, so routing is left alone.
    const plain = request({ extraBody, output: { name: "out", schema, mode: "json_object" } });
    expect(chatCompletionBody(plain, true).provider).toEqual({ order: ["x"] });
  });
});

describe("openai-compatible transport", () => {
  it("posts to {baseUrl}/chat/completions with a bearer token and the caller's headers", async () => {
    const fetch = fetchReturning(200, { choices: [{ message: { content: "{}" } }] });
    const provider = openAiCompatible({
      apiKey: "key",
      baseUrl: "https://gateway.invalid/api/v1/",
      headers: { "HTTP-Referer": "https://site.invalid" },
      fetch,
    });
    await provider.complete(request());

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://gateway.invalid/api/v1/chat/completions");
    expect(init.headers).toMatchObject({
      authorization: "Bearer key",
      "content-type": "application/json",
      "HTTP-Referer": "https://site.invalid",
    });
  });

  it("defaults to the OpenAI endpoint when no base URL is configured", async () => {
    const fetch = fetchReturning(200, { choices: [] });
    await openAiCompatible({ apiKey: "key", baseUrl: "", fetch }).complete(request());
    expect(fetch.mock.calls[0]![0]).toBe("https://api.openai.com/v1/chat/completions");
  });

  it("maps the reply, usage and finish reason", async () => {
    const fetch = fetchReturning(200, {
      id: "c1",
      choices: [{ finish_reason: "length", message: { content: "{" } }],
      usage: { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 },
    });
    const response = await openAiCompatible({ apiKey: "k", fetch }).complete(request());
    expect(response).toEqual({
      text: "{",
      id: "c1",
      usage: { inputTokens: 12, outputTokens: 3 },
      finish: "length",
    });
  });

  it("reports a structured-output refusal as a refusal", async () => {
    const fetch = fetchReturning(200, {
      choices: [{ finish_reason: "stop", message: { content: null, refusal: "I can't." } }],
    });
    const response = await openAiCompatible({ apiKey: "k", fetch }).complete(request());
    expect(response.finish).toBe("refusal");
    expect(response.text).toBe("");
  });

  it.each([
    [400, false],
    [401, false],
    [404, false],
    [429, true],
    [500, true],
    [503, true],
  ])("treats HTTP %i as retryable: %s", async (status, retryable) => {
    const provider = openAiCompatible({ apiKey: "k", fetch: fetchReturning(status, "nope") });
    const error = await provider.complete(request()).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(LlmProviderError);
    expect(error).toMatchObject({ status, retryable });
  });

  it("keeps keys out of an error body that echoes the request", async () => {
    // A proxy that echoes what it was sent puts the key in the body, and so in the message.
    const echo = [
      "authorization: Bearer sk-invented-0123456789",
      "x-api-key: sk-ant-api03-other-key_9876543210",
      "x-goog-api-key: AIzaInvented0123456789abcdef",
      "token=Bearer eyJhbGciOiJIUzI1NiJ9.invented",
    ].join("\n");
    const provider = openAiCompatible({
      apiKey: "sk-invented-0123456789",
      headers: { "x-goog-api-key": "AIzaInvented0123456789abcdef" },
      fetch: fetchReturning(400, echo),
    });
    const error = (await provider.complete(request()).catch((caught: unknown) => caught)) as Error;
    expect(error.message).toContain("HTTP 400");
    expect(error.message).toContain("authorization:");
    for (const secret of ["0123456789", "9876543210", "AIzaInvented", "eyJhbGci"])
      expect(error.message).not.toContain(secret);
  });

  it("treats an unreadable body and a network failure as retryable", async () => {
    const garbled = openAiCompatible({ apiKey: "k", fetch: fetchReturning(200, "<html>") });
    await expect(garbled.complete(request())).rejects.toMatchObject({ retryable: true });

    const offline = openAiCompatible({
      apiKey: "k",
      fetch: vi.fn<FetchLike>(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    await expect(offline.complete(request())).rejects.toMatchObject({ retryable: true });
  });

  it("times out a hung request as a retryable failure", async () => {
    const hung = vi.fn<FetchLike>(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal?.addEventListener("abort", () => reject(new Error("aborted"))),
        ),
    );
    const provider = openAiCompatible({ apiKey: "k", fetch: hung, timeoutMs: 20 });
    await expect(provider.complete(request())).rejects.toMatchObject({
      message: "Provider request timed out.",
      retryable: true,
    });
  });

  it("refuses to start without an API key", () => {
    expect(() => openAiCompatible({ apiKey: "" })).toThrow(LlmProviderError);
  });
});

describe("anthropic request body", () => {
  it("uses output_config.format with nullable fields written as anyOf", () => {
    const body = messagesBody(request());
    expect(body).toEqual({
      model: "m",
      max_tokens: 100,
      system: "sys",
      messages: [{ role: "user", content: "hi" }],
      output_config: {
        format: {
          type: "json_schema",
          schema: {
            type: "object",
            properties: {
              name: { anyOf: [{ type: "string" }, { type: "null" }] },
              tags: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
            },
            required: ["name", "tags"],
            additionalProperties: false,
          },
        },
      },
    });
  });

  it("sends no output_config or temperature unless there is something to send", () => {
    const body = messagesBody(request({ output: { name: "out", schema, mode: "json_object" } }));
    expect(body).not.toHaveProperty("output_config");
    expect(body).not.toHaveProperty("temperature");
  });

  it("merges output_config from provider options with the format", () => {
    const body = messagesBody(request({ extraBody: { output_config: { effort: "low" }, x: 1 } }));
    expect(body.output_config).toMatchObject({ effort: "low", format: { type: "json_schema" } });
    expect(body).toMatchObject({ x: 1 });
  });
});

describe("anthropic transport", () => {
  it("posts to /v1/messages with the key and version headers", async () => {
    const fetch = fetchReturning(200, { content: [] });
    await anthropic({ apiKey: "key", fetch }).complete(request());

    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(init.headers).toMatchObject({ "x-api-key": "key", "anthropic-version": "2023-06-01" });
    expect(sentBody(fetch).model).toBe("m");
  });

  it("joins text blocks, counts cached input, and maps stop reasons", async () => {
    const fetch = fetchReturning(200, {
      id: "msg_1",
      content: [
        { type: "thinking", thinking: "" },
        { type: "text", text: '{"a":' },
        { type: "text", text: "1}" },
      ],
      stop_reason: "end_turn",
      usage: {
        input_tokens: 5,
        cache_creation_input_tokens: 2,
        cache_read_input_tokens: 3,
        output_tokens: 7,
      },
    });
    expect(await anthropic({ apiKey: "k", fetch }).complete(request())).toEqual({
      text: '{"a":1}',
      id: "msg_1",
      // The total, with the cached part broken out: it is priced differently.
      usage: { inputTokens: 10, outputTokens: 7, cacheReadTokens: 3, cacheWriteTokens: 2 },
      finish: "stop",
    });
  });

  it.each([
    ["max_tokens", "length"],
    ["refusal", "refusal"],
    ["pause_turn", "other"],
  ])("maps stop_reason %s to %s", async (stopReason, finish) => {
    const fetch = fetchReturning(200, { content: [], stop_reason: stopReason });
    expect((await anthropic({ apiKey: "k", fetch }).complete(request())).finish).toBe(finish);
  });
});

describe("redirects", () => {
  // fetch drops `authorization` on a cross-origin redirect but keeps `x-api-key`, and a 307
  // resends the body: following one hands the key and the resume to whoever answered.
  async function listen(handler: http.RequestListener): Promise<[http.Server, string]> {
    const server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return [server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`];
  }

  /** A provider address that redirects with `status` to a second server, which records calls. */
  async function redirecting(status: number) {
    const seen: http.IncomingHttpHeaders[] = [];
    const [other, otherUrl] = await listen((req, res) => {
      seen.push(req.headers);
      req.resume();
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ content: [{ type: "text", text: "{}" }], choices: [] }));
    });
    const [configured, url] = await listen((req, res) => {
      req.resume();
      res.statusCode = status;
      res.setHeader("location", `${otherUrl}/steal`);
      res.end();
    });
    return { seen, url, close: () => (configured.close(), other.close()) };
  }
  const providers = (baseUrl: string, fetch?: FetchLike) => [
    anthropic({ apiKey: "sk-ant-invented", baseUrl, ...(fetch && { fetch }) }),
    openAiCompatible({ apiKey: "sk-invented", baseUrl, ...(fetch && { fetch }) }),
  ];

  it.each([301, 302, 303, 307, 308])(
    "never follows a %i, so the key and the body stay with the configured address",
    async (status) => {
      const { seen, url, close } = await redirecting(status);
      try {
        for (const provider of providers(url)) {
          const error = await provider.complete(request()).catch((caught: unknown) => caught);
          expect(error).toBeInstanceOf(LlmProviderError);
          expect(error).toMatchObject({ retryable: false });
          // The origin only: a path can carry a deployment's own tokens.
          expect((error as Error).message).toBe(
            `The provider at ${new URL(url).origin} answered with a redirect (HTTP ${status}), which is never followed: it would take the API key and the request elsewhere. Set the base URL to the address the provider answers at.`,
          );
        }
        expect(seen).toEqual([]);
      } finally {
        close();
      }
    },
  );

  it("refuses the answer of a caller's fetch that followed one anyway", async () => {
    const { url, close } = await redirecting(307);
    // A wrapper that drops `redirect`, so the platform's fetch follows: the key has gone, but the
    // answer is not used and the caller hears why.
    const following: FetchLike = (target, init) =>
      fetch(target, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: init.signal as AbortSignal,
      });
    try {
      for (const provider of providers(url, following))
        await expect(provider.complete(request())).rejects.toMatchObject({
          retryable: false,
          message: expect.stringMatching(/answered with a redirect, which is never followed/),
        });
    } finally {
      close();
    }
  });

  it("asks a caller's own fetch to hand back a redirect rather than follow it", async () => {
    const fetch = fetchReturning(200, { content: [] });
    await anthropic({ apiKey: "k", fetch }).complete(request());
    expect(fetch.mock.calls[0]![1]).toMatchObject({ redirect: "manual" });
  });

  it("reads a browser's opaque redirect as one, and a network error naming 'redirect' as none", async () => {
    const opaque = vi.fn<FetchLike>(async () => ({
      ok: false,
      status: 0,
      type: "opaqueredirect",
      text: async () => "",
    }));
    await expect(
      anthropic({ apiKey: "k", fetch: opaque }).complete(request()),
    ).rejects.toMatchObject({
      retryable: false,
      message: expect.stringMatching(/answered with a redirect, which/),
    });

    const offline = vi.fn<FetchLike>(async () => {
      throw new TypeError("fetch failed", {
        cause: new Error("getaddrinfo ENOTFOUND redirect.example.com"),
      });
    });
    await expect(
      anthropic({ apiKey: "k", fetch: offline }).complete(request()),
    ).rejects.toMatchObject({ retryable: true, message: "Network error." });
  });
});
