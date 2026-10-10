/**
 * Just enough of `fetch` for the adapters.
 *
 * The package compiles without DOM or Node types so that nothing runtime-specific leaks into
 * the browser build, which means the platform's `fetch` and `AbortSignal` are described here
 * structurally rather than imported. Every runtime the package targets — Node
 * 22.12+, browsers, edge workers — provides them.
 */

import { isRetryableStatus, LlmProviderError, type AbortSignalLike } from "./provider.js";

export type { AbortSignalLike };

/** Just enough of a `fetch` response for the adapters. */
export type FetchResponseLike = {
  ok: boolean;
  status: number;
  text(): Promise<string>;
  /** True when `fetch` followed a redirect to get this response: it is refused. */
  redirected?: boolean;
  /** `"opaqueredirect"` is a browser's redirect handed back unfollowed: it is refused. */
  type?: string;
};

/** Just enough of `fetch` for the adapters: one POST. Pass your own to proxy or record calls. */
export type FetchLike = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignalLike;
    /**
     * Always `"manual"`: a redirect is handed back, never followed, and the call fails. `fetch`
     * keeps headers such as `x-api-key` on a redirect to another origin, and a 307 or 308 resends
     * the body, so following one would hand the key and the resume to whoever answered. Pass it
     * on to the `fetch` you wrap; a response that was redirected anyway is refused.
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
};

/** Options every HTTP adapter accepts. */
export type HttpOptions = {
  /** Per-attempt timeout. Defaults to 120 s. */
  timeoutMs?: number;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
  /** Defaults to the global `fetch`. */
  fetch?: FetchLike;
};

/** Thrown when the caller's own signal aborted the call. Never retried. */
export class AbortedError extends Error {
  constructor(cause?: unknown) {
    super("The request was aborted.", { cause });
    this.name = "AbortError";
  }
}

/**
 * Whether the response is a redirect, by the response alone: a 3xx handed back (Node, workers),
 * a browser's opaque redirect (status 0), or a response a caller's `fetch` reached by following
 * one regardless.
 */
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

/** A bearer token, or a key in a provider's usual form ("sk-…", "sk-ant-…", "AIza…"). */
const SECRET = /\b[Bb]earer\s+[^\s"',;]+|\b(?:sk|pk|rk)-[\w-]{8,}|\bAIza[\w-]{20,}/g;

/**
 * An error body with the credentials taken out. A proxy or gateway that echoes the request puts
 * the key in its error, and the error's message is printed and logged.
 */
function withoutSecrets(text: string, headers: Record<string, string>): string {
  let out = text;
  for (const [name, value] of Object.entries(headers))
    if (SECRET_HEADER.test(name) && value.length >= 8)
      for (const secret of [value, value.replace(/^Bearer\s+/i, "")])
        out = out.split(secret).join("[redacted]");
  return out.replace(SECRET, (match) =>
    /^Bearer/i.test(match) ? "Bearer [redacted]" : "[redacted]",
  );
}

/**
 * POSTs `body` as JSON and returns the parsed JSON response.
 *
 * Every failure becomes an `LlmProviderError` with the shared retry rule applied, except an
 * abort the caller asked for, which is an `AbortedError` — the caller has stopped waiting, so
 * there is nothing to retry for. A timeout is the adapter's own abort and is retryable.
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
    raw = await response.text();
  } catch (error) {
    if (error instanceof LlmProviderError) throw error;
    if (options.signal?.aborted) throw new AbortedError(error);
    throw new LlmProviderError(timeout.aborted ? "Provider request timed out." : "Network error.", {
      retryable: true,
      cause: error,
    });
  }

  if (!response.ok) {
    const excerpt = withoutSecrets(raw.slice(0, 1_000), headers).slice(0, 500);
    throw new LlmProviderError(`Provider returned HTTP ${response.status}: ${excerpt}`, {
      status: response.status,
      retryable: isRetryableStatus(response.status),
    });
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
  // Adapters read fields off the body; anything but an object is a bad response, not a crash.
  if (!json || typeof json !== "object" || Array.isArray(json))
    throw new LlmProviderError("Provider returned JSON that is not an object.", {
      status: response.status,
      retryable: true,
    });
  return json;
}
