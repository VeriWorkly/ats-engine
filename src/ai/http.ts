/** `fetch` and `AbortSignal` are described structurally: the package compiles without DOM or Node types. */

import { isRetryableStatus, LlmProviderError, type AbortSignalLike } from "./provider.js";

export type { AbortSignalLike };

/** Just enough of a `fetch` response for the adapters. */
export type FetchResponseLike = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  /** True when `fetch` followed a redirect to get this response: it is refused. */
  redirected?: boolean | undefined;
  /** `"opaqueredirect"` is a browser's redirect handed back unfollowed: it is refused. */
  type?: string | undefined;
  /** A declared `content-length` past `MAX_RESPONSE_BYTES` is refused before the body is read. */
  headers?: { get(name: string): string | null } | undefined;
  /** Read as a stream when there is one, so a body past the limit stops there. */
  body?:
    | {
        getReader(): {
          read(): Promise<{ done: boolean; value?: Uint8Array }>;
          cancel(): Promise<void>;
        };
      }
    | null
    | undefined;
};

/** The most of a provider's answer that is read, an error's included; the timeout does not bound size. */
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** Just enough of `fetch` for the adapters: one POST. Pass your own to proxy or record calls. */
export type FetchLike = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignalLike;
    /**
     * Always `"manual"`: a redirect fails the call, because `fetch` keeps `x-api-key` across
     * origins and a 307/308 resends the body. Pass it on to the `fetch` you wrap.
     */
    redirect?: "manual";
  },
) => Promise<FetchResponseLike>;

const platform = globalThis as unknown as {
  fetch?: FetchLike;
  AbortSignal: {
    timeout(ms: number): AbortSignalLike;
    any(signals: AbortSignalLike[]): AbortSignalLike;
  };
  TextDecoder: new () => { decode(bytes: Uint8Array, options?: { stream: boolean }): string };
};

/** The response's body as text, refused past `MAX_RESPONSE_BYTES`. */
async function readLimited(response: FetchResponseLike): Promise<string> {
  const tooBig = () =>
    new LlmProviderError(
      `The provider answered with more than ${MAX_RESPONSE_BYTES / 1024 / 1024} MB, which is not read.`,
      response.ok
        ? { retryable: false }
        : { status: response.status, retryable: isRetryableStatus(response.status) },
    );
  // Only a platform `fetch`'s headers and stream body are used; anything else is read with `text()`.
  const headers = response.headers;
  if (
    typeof headers?.get === "function" &&
    Number(headers.get("content-length")) > MAX_RESPONSE_BYTES
  )
    throw tooBig();
  const body = response.body;
  const reader = typeof body?.getReader === "function" ? body.getReader() : undefined;
  // shortcut: a fetch without a stream body is read whole, then measured.
  if (!reader) {
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw tooBig();
    return text;
  }
  const decoder = new platform.TextDecoder();
  let bytes = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode(new Uint8Array(0));
    bytes += value?.length ?? 0;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw tooBig();
    }
    if (value) text += decoder.decode(value, { stream: true });
  }
}

/** Options every HTTP adapter accepts. */
export type HttpOptions = {
  /** Per-attempt timeout. Defaults to 120 s. */
  timeoutMs?: number | undefined;
  /** Extra headers sent with every request. */
  headers?: Record<string, string> | undefined;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike | undefined;
};

/** Thrown when the caller's own signal aborted the call. Never retried. */
export class AbortedError extends Error {
  constructor(cause?: unknown) {
    super("The request was aborted.", { cause });
    this.name = "AbortError";
  }
}

/** A 3xx, a browser's opaque redirect (status 0), or a response a caller's `fetch` followed. */
function isRedirect(response: FetchResponseLike): boolean {
  return (
    (response.status >= 300 && response.status < 400) ||
    response.status === 0 ||
    response.type === "opaqueredirect" ||
    response.redirected === true
  );
}

/** Scheme, host and port only: a path or query can carry a deployment's own tokens. */
function originOf(url: string): string {
  // No `URL` here: the package compiles without DOM or Node types. Any user:password goes too.
  const match = /^([a-z][a-z\d+.-]*:\/\/)([^/?#]*)/i.exec(url);
  return match ? `${match[1]}${match[2]!.replace(/^.*@/, "")}` : "the configured address";
}

/** A header whose value is a credential. */
const SECRET_HEADER = /auth|key|token|secret/i;

/** A bearer token, or a key in a provider's form: sk-, pk-, rk-, xai-, gsk_, hf_, r8_, tgp_v1_, AIza. */
const SECRET =
  /\b[Bb]earer\s+[^\s"',;]+|\b(?:sk|pk|rk|xai)-[\w-]{8,}|\b(?:gsk|hf|r8|tgp_v1)_[\w-]{8,}|\bAIza[\w-]{20,}/g;

/** A JSON member, its name and its string value: `"api_key": "…"`. */
const JSON_MEMBER = /"([\w-]{1,64})"(\s*:\s*)"(?:[^"\\]|\\.)*"/g;

/** An error body with credentials removed: a gateway that echoes the request puts the key in it. */
function withoutSecrets(text: string, headers: Record<string, string>): string {
  let out = text;
  for (const [name, value] of Object.entries(headers))
    if (SECRET_HEADER.test(name))
      // At least eight characters each: a short test key would rewrite every word it is part of.
      for (const secret of [value, value.replace(/^Bearer\s+/i, "")])
        if (secret.length >= 8) out = out.split(secret).join("[redacted]");
  return out
    .replace(JSON_MEMBER, (member, name: string, colon: string) =>
      SECRET_HEADER.test(name) ? `"${name}"${colon}"[redacted]"` : member,
    )
    .replace(SECRET, (match) => (/^Bearer/i.test(match) ? "Bearer [redacted]" : "[redacted]"));
}

/** The most of a provider's own error text an error message quotes. */
const MAX_PROVIDER_TEXT = 200;

/**
 * What an error body says in the provider's own words: a JSON body's `error.message` (or a
 * `message` or `error` string), else a short one-line text body ("Bad Gateway"); "" otherwise. A
 * gateway may echo the request, the resume with it, around that text: the rest is never quoted.
 */
function providerSays(raw: string): string {
  let said: unknown = raw.trim();
  try {
    const json = JSON.parse(raw) as Record<string, unknown> | null;
    const error = json?.error as Record<string, unknown> | string | undefined;
    said = typeof error === "string" ? error : (error?.message ?? json?.message);
  } catch {
    // Not JSON: plain text, quoted only when it is a short line.
  }
  return typeof said === "string" && said.length <= MAX_PROVIDER_TEXT && !said.includes("\n")
    ? said.trim()
    : "";
}

/**
 * POSTs `body` as JSON and returns the parsed JSON response. Every failure is an
 * `LlmProviderError` with the shared retry rule, except the caller's own abort (`AbortedError`).
 */
export async function postJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  options: HttpOptions & { signal?: AbortSignalLike },
): Promise<unknown> {
  const fetchImpl = options.fetch ?? platform.fetch;
  if (!fetchImpl) throw new LlmProviderError("No fetch implementation.", { retryable: false });
  if (options.signal?.aborted) throw new AbortedError(options.signal.reason);

  const timeout = platform.AbortSignal.timeout(options.timeoutMs ?? 120_000);
  const signal = options.signal ? platform.AbortSignal.any([options.signal, timeout]) : timeout;

  let response: FetchResponseLike;
  let raw: string;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal,
      redirect: "manual",
    });
    if (isRedirect(response)) {
      const status = response.status >= 300 && response.status < 400;
      throw new LlmProviderError(
        `The provider at ${originOf(url)} answered with a redirect${status ? ` (HTTP ${response.status})` : ""}, which is never followed: it would take the API key and the request elsewhere. Set the base URL to the address the provider answers at.`,
        { retryable: false, ...(status && { status: response.status }) },
      );
    }
    raw = await readLimited(response);
  } catch (error) {
    if (error instanceof LlmProviderError) throw error;
    if (options.signal?.aborted) throw new AbortedError(error);
    throw new LlmProviderError(timeout.aborted ? "Provider request timed out." : "Network error.", {
      retryable: true,
      cause: error,
    });
  }

  if (!response.ok) {
    const said = providerSays(raw);
    const excerpt = said && withoutSecrets(said, headers);
    throw new LlmProviderError(
      `Provider returned HTTP ${response.status}${excerpt ? `: ${excerpt}` : "."}`,
      {
        status: response.status,
        retryable: isRetryableStatus(response.status),
      },
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (error) {
    throw new LlmProviderError("Provider returned a body that is not JSON.", {
      status: response.status,
      retryable: true,
      cause: error,
    });
  }
  if (!json || typeof json !== "object" || Array.isArray(json))
    throw new LlmProviderError("Provider returned JSON that is not an object.", {
      status: response.status,
      retryable: true,
    });
  return json;
}
