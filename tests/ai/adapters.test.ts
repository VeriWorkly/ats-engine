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
    expect((chatCompletionBody(plain, true) as { provider?: unknown }).provider).toEqual({
      order: ["x"],
    });
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
    // A proxy that echoes the request puts the key in the error message.
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
    expect(error.message).toBe("Provider returned HTTP 400.");
    for (const secret of ["0123456789", "9876543210", "AIzaInvented", "eyJhbGci"])
      expect(error.message).not.toContain(secret);
  });

  // A gateway that echoes the request put the resume, name, email and phone, in the message.
  it("quotes only the provider's own error text, never an echoed request", async () => {
    const resume = "Jane Doe jane.doe@example.com +1 415 555 0134";
    const json = JSON.stringify({
      error: { message: "Invalid value for 'temperature'.", type: "invalid_request_error" },
      request: { messages: [{ role: "user", content: resume }] },
    });
    const text = `Bad request. Received body:\n{"messages":[{"content":"${resume}"}]}`;
    for (const [body, expected] of [
      [json, "Provider returned HTTP 400: Invalid value for 'temperature'."],
      [text, "Provider returned HTTP 400."],
      ["Bad Gateway", "Provider returned HTTP 400: Bad Gateway"],
    ]) {
      const provider = openAiCompatible({ apiKey: "k", fetch: fetchReturning(400, body!) });
      const error = (await provider
        .complete(request())
        .catch((caught: unknown) => caught)) as Error;
      expect(error.message).toBe(expected);
    }
  });

  it("keeps a key out of the provider's own error text", async () => {
    const body = JSON.stringify({
      error: { message: "Incorrect API key provided: sk-invented-0123456789." },
    });
    const provider = openAiCompatible({
      apiKey: "sk-invented-0123456789",
      fetch: fetchReturning(401, body),
    });
    const error = (await provider.complete(request()).catch((caught: unknown) => caught)) as Error;
    expect(error.message).toBe(
      "Provider returned HTTP 401: Incorrect API key provided: [redacted].",
    );
  });

  // In the text an error quotes: a body that is not quoted passed whatever the redaction did.
  it("keeps other providers' keys and JSON key fields out of an error body too", async () => {
    // Keys of other services: Groq, Hugging Face, xAI, Replicate, Together.
    const keys = JSON.stringify({
      error: {
        message:
          "Rejected gsk_Invented0123456789 hf_Invented0123456789 xai-Invented0123456789 " +
          "r8_Invented0123456789 tgp_v1_Invented0123456789",
      },
    });
    const members = `Rejected ${JSON.stringify({
      api_key: "plainsecret1",
      apiKey: "plainsecret2",
      "x-api-key": "plainsecret3",
      access_token: "plainsecret4",
    })}`;
    for (const [body, expected] of [
      [keys, "Rejected [redacted] [redacted] [redacted] [redacted] [redacted]"],
      [
        members,
        'Rejected {"api_key":"[redacted]","apiKey":"[redacted]","x-api-key":"[redacted]",' +
          '"access_token":"[redacted]"}',
      ],
    ]) {
      const provider = openAiCompatible({ apiKey: "k", fetch: fetchReturning(401, body!) });
      const error = (await provider
        .complete(request())
        .catch((caught: unknown) => caught)) as Error;
      expect(error.message).toBe(`Provider returned HTTP 401: ${expected}`);
    }
  });

  // A lone CR or a Unicode line separator ended a line too, and the echo after it was quoted.
  it.each([
    ["a lone CR", "\r"],
    ["a line separator", String.fromCodePoint(0x2028)],
    ["a paragraph separator", String.fromCodePoint(0x2029)],
    ["a vertical tab", "\v"],
  ])("does not quote a text body broken by %s", async (_label, gap) => {
    const body = `Bad request.${gap}{"content":"Jane Doe jane.doe@example.com"}`;
    const provider = openAiCompatible({ apiKey: "k", fetch: fetchReturning(400, body) });
    const error = (await provider.complete(request()).catch((caught: unknown) => caught)) as Error;
    expect(error.message).toBe("Provider returned HTTP 400.");
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

  // A `fetch` that never settles and ignores the signal held the call past `timeoutMs`, forever.
  it("gives up at timeoutMs even when the fetch ignores the signal", async () => {
    const deaf = vi.fn<FetchLike>(() => new Promise(() => {}));
    const started = performance.now();
    await expect(
      openAiCompatible({ apiKey: "k", fetch: deaf, timeoutMs: 20 }).complete(request()),
    ).rejects.toMatchObject({ message: "Provider request timed out.", retryable: true });
    expect(performance.now() - started).toBeLessThan(1_000);

    // The caller's own abort is an abort, never retried.
    const controller = new AbortController();
    const pending = anthropic({ apiKey: "k", fetch: deaf }).complete(
      request({ signal: controller.signal }),
    );
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("reads retry-after, in seconds or as a date, onto the error", async () => {
    const answer = (value: string) =>
      vi.fn<FetchLike>(async () => ({
        ok: false,
        status: 429,
        headers: { get: (name: string) => (name === "retry-after" ? value : null) },
        text: async () => "",
      }));
    const after = async (value: string) =>
      (
        (await openAiCompatible({ apiKey: "k", fetch: answer(value) })
          .complete(request())
          .catch((caught: unknown) => caught)) as LlmProviderError
      ).retryAfterMs;
    expect(await after("7")).toBe(7_000);
    expect(await after("0.5")).toBe(500);
    const date = await after(new Date(Date.now() + 30_000).toUTCString());
    expect(date).toBeGreaterThan(28_000);
    expect(date).toBeLessThanOrEqual(30_000);
    expect(await after(new Date(Date.now() - 30_000).toUTCString())).toBe(0);
    expect(await after("soon")).toBeUndefined();
    // Only decimal seconds: `Number` would read these as 16 s and 1,000 s.
    expect(await after("0x10")).toBeUndefined();
    expect(await after("1e3")).toBeUndefined();
    expect(await after("-1")).toBeUndefined();
    // No digit is no number of seconds: a blank is the normal backoff, never 0 s.
    expect(await after(" ")).toBeUndefined();
    expect(await after(" 3 ")).toBe(3_000);
  });

  // An error sent with HTTP 200 read as an empty reply: "invalid_output: Empty response", retried.
  it.each([
    [
      "an OpenAI-compatible error",
      { error: { message: "Model overloaded, try later", code: 503 } },
      "Provider returned an error: Model overloaded, try later",
      { status: 503, retryable: true },
    ],
    [
      "an OpenAI-compatible rejection",
      { error: { message: "Invalid model id", code: 400 } },
      "Provider returned an error: Invalid model id",
      { status: 400, retryable: false },
    ],
    [
      "an Anthropic error",
      { type: "error", error: { type: "overloaded_error", message: "Overloaded" } },
      "Provider returned an error: Overloaded",
      { retryable: true },
    ],
    [
      "an Anthropic rejection",
      { type: "error", error: { type: "invalid_request_error", message: "Bad schema" } },
      "Provider returned an error: Bad schema",
      { retryable: false },
    ],
    [
      "a Gemini error list",
      [{ error: { code: 429, message: "Quota exceeded", status: "RESOURCE_EXHAUSTED" } }],
      "Provider returned an error: Quota exceeded",
      { status: 429, retryable: true },
    ],
    [
      "an error that echoes the request and the key",
      {
        error: { message: "Bad key sk-invented-0123456789" },
        request: { messages: [{ content: "Jane Doe jane.doe@example.com" }] },
      },
      "Provider returned an error: Bad key [redacted]",
      { retryable: true },
    ],
    // A bare string is judged by its words, as an error's `type` is.
    [
      "a rejection as a bare string",
      { error: "Invalid API key" },
      "Provider returned an error: Invalid API key",
      { retryable: false },
    ],
    [
      "a missing model as a bare string",
      { error: "Model not found" },
      "Provider returned an error: Model not found",
      { retryable: false },
    ],
    [
      "an outage as a bare string",
      { error: "Upstream busy, try again" },
      "Provider returned an error: Upstream busy, try again",
      { retryable: true },
    ],
  ])("reads %s sent with HTTP 200 as a provider error", async (_label, body, message, fields) => {
    for (const make of [openAiCompatible, anthropic]) {
      const provider = make({ apiKey: "sk-invented-0123456789", fetch: fetchReturning(200, body) });
      const error = await provider.complete(request()).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(LlmProviderError);
      expect(error).toMatchObject({ message, ...fields });
    }
  });

  // A gateway that adds an empty `error` to every answer: each one failed, and was retried.
  it.each([
    ["null", null],
    ["an empty object", {}],
    ["an empty string", ""],
    ["false", false],
    ["an error with a message", { message: "partial outage elsewhere" }],
  ])("reads an answer sent beside an error that is %s as the answer", async (_label, error) => {
    const text = '{"name":"Jane","tags":null}';
    const openAi = { choices: [{ message: { content: text }, finish_reason: "stop" }], error };
    const claude = { type: "message", content: [{ type: "text", text }], stop_reason: "end_turn" };
    await expect(
      openAiCompatible({ apiKey: "k", fetch: fetchReturning(200, openAi) }).complete(request()),
    ).resolves.toMatchObject({ text, finish: "stop" });
    await expect(
      anthropic({ apiKey: "k", fetch: fetchReturning(200, { ...claude, error }) }).complete(
        request(),
      ),
    ).resolves.toMatchObject({ text, finish: "stop" });
  });

  it("reads an empty error with no answer as an empty reply, not as a provider error", async () => {
    const provider = openAiCompatible({ apiKey: "k", fetch: fetchReturning(200, { error: {} }) });
    await expect(provider.complete(request())).resolves.toMatchObject({ text: "" });
  });

  it.each([
    [
      "FastAPI's detail",
      { detail: "Model not loaded" },
      "Provider returned HTTP 422: Model not loaded",
    ],
    [
      "a Gemini error list",
      [{ error: { code: 422, message: "API key not valid", status: "INVALID_ARGUMENT" } }],
      "Provider returned HTTP 422: API key not valid",
    ],
    [
      "a top-level message beside an empty one",
      { error: { message: "" }, message: "Context too long" },
      "Provider returned HTTP 422: Context too long",
    ],
    [
      "FastAPI's validation list, which echoes the input",
      { detail: [{ loc: ["body"], msg: "bad", input: "Jane Doe jane.doe@example.com" }] },
      "Provider returned HTTP 422.",
    ],
  ])("quotes %s in an error", async (_label, body, message) => {
    const provider = openAiCompatible({ apiKey: "k", fetch: fetchReturning(422, body) });
    await expect(provider.complete(request())).rejects.toMatchObject({ message, status: 422 });
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
  // fetch keeps `x-api-key` across origins and a 307 resends the body.
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

describe("the provider's answer is read to a limit", () => {
  // The timeout bounds how long, not how much: a broken or hostile endpoint could stream gigabytes
  // into memory before it fired.
  async function answering(handler: http.RequestListener): Promise<[http.Server, string]> {
    const server = http.createServer(handler);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return [server, `http://127.0.0.1:${(server.address() as AddressInfo).port}`];
  }
  const tooBig = /answered with more than 4 MB/;

  it("stops reading an answer that never ends", async () => {
    let sent = 0;
    const [server, baseUrl] = await answering((req, res) => {
      req.resume();
      res.setHeader("content-type", "application/json");
      const chunk = Buffer.alloc(64 * 1024, 32);
      const pump = () => {
        while (sent < 64 * 1024 * 1024 && res.write(chunk)) sent += chunk.length;
        if (sent < 64 * 1024 * 1024) res.once("drain", pump);
        else res.end();
      };
      pump();
    });
    try {
      const provider = openAiCompatible({ apiKey: "k", baseUrl });
      await expect(provider.complete(request())).rejects.toMatchObject({
        retryable: false,
        message: expect.stringMatching(tooBig),
      });
      expect(sent).toBeLessThan(64 * 1024 * 1024);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });

  it("refuses an answer that declares more, an error included, before reading it", async () => {
    const read = vi.fn(async () => "{}");
    const fetch = vi.fn<FetchLike>(async () => ({
      ok: false,
      status: 500,
      headers: {
        get: (name: string) => (name === "content-length" ? String(5 * 1024 * 1024) : null),
      },
      text: read,
    }));
    // A 500 stays retryable however much it says: a gateway's error page is not the model's answer.
    await expect(anthropic({ apiKey: "k", fetch }).complete(request())).rejects.toMatchObject({
      message: expect.stringMatching(tooBig),
      status: 500,
      retryable: true,
    });
    expect(read).not.toHaveBeenCalled();
  });

  // A body without a reader, or headers without `get`, is read with `text()`.
  it.each([
    ["a Node stream body", { body: { pipe() {} }, headers: new Map() }],
    ["a string body", { body: "{}" }],
    ["plain-object headers", { headers: { "content-type": "application/json" } }],
  ])("reads an answer with %s", async (_, shape) => {
    const answer = { content: [{ type: "text", text: '{"ok":true}' }] };
    const fetch = vi.fn<FetchLike>(
      async () =>
        ({ ok: true, status: 200, text: async () => JSON.stringify(answer), ...shape }) as never,
    );
    await expect(anthropic({ apiKey: "k", fetch }).complete(request())).resolves.toBeDefined();
  });

  it("refuses an answer a host's fetch hands over whole", async () => {
    const fetch = fetchReturning(200, "x".repeat(5 * 1024 * 1024));
    await expect(anthropic({ apiKey: "k", fetch }).complete(request())).rejects.toThrow(tooBig);
  });
});
