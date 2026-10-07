import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { FetchLike } from "../src/ai/http.js";
import { resolveAiConfig } from "../src/cli/ai.js";
import { main, type CliContext } from "../src/cli/main.js";
import { banner, colorDepth, detectTerminal, PLAIN, type Terminal } from "../src/cli/terminal.js";
import { ENGINE_VERSION } from "../src/version.js";

const dir = mkdtempSync(join(tmpdir(), "ats-cli-ai-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const RESUME = [
  "Jane Doe",
  "jane.doe@example.com | (415) 555-0199",
  "",
  "Experience",
  "Senior Engineer, Acme Corporation",
  "Jan 2020 - Present",
  "- Built payment systems in TypeScript, cutting failures 40%.",
  "",
  "Education",
  "BSc Computer Science, State University, 2015",
  "",
  "Skills",
  "TypeScript, Go, PostgreSQL",
].join("\n");

const resumePath = join(dir, "resume.txt");
writeFileSync(resumePath, RESUME);

/** An SGR escape sequence: everything colour adds to the text. */
const ESCAPES = new RegExp(`${String.fromCharCode(27)}\\[[\\d;]*m`, "g");
const HAS_ESCAPE = new RegExp(ESCAPES.source);
const strip = (text: string) => text.replace(ESCAPES, "");

const WIDE: Terminal = { depth: 24, interactive: true, columns: 120 };

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void out.push(line));
  vi.spyOn(console, "error").mockImplementation((line: string) => void err.push(line));
});

const context = (overrides: Partial<CliContext> = {}): CliContext => ({
  terminal: PLAIN,
  env: {},
  ...overrides,
});

describe("colour", () => {
  const tty = (depth: number) => ({ isTTY: true, getColorDepth: () => depth });

  it("follows NO_COLOR over FORCE_COLOR, FORCE_COLOR over the stream, and the stream last", () => {
    expect(colorDepth(tty(24), { NO_COLOR: "1", FORCE_COLOR: "3" })).toBe(1);
    expect(colorDepth({ isTTY: false }, { FORCE_COLOR: "1" })).toBe(4);
    expect(colorDepth({ isTTY: false }, { FORCE_COLOR: "2" })).toBe(8);
    expect(colorDepth({ isTTY: false }, { FORCE_COLOR: "3" })).toBe(24);
    expect(colorDepth(tty(24), { FORCE_COLOR: "0" })).toBe(1);
    expect(colorDepth({ isTTY: false }, {})).toBe(1);
    expect(colorDepth(tty(8), {})).toBe(8);
    expect(colorDepth(tty(2), {})).toBe(1);
  });

  it("counts an empty NO_COLOR as unset, as no-color.org says", () => {
    expect(colorDepth(tty(24), { NO_COLOR: "" })).toBe(24);
  });

  it("treats only a terminal outside CI as interactive", () => {
    expect(detectTerminal(tty(24), {}).interactive).toBe(true);
    expect(detectTerminal(tty(24), { CI: "true" }).interactive).toBe(false);
    expect(detectTerminal({ isTTY: false }, {}).interactive).toBe(false);
  });

  it("changes nothing but the escapes: coloured output stripped is the plain output", async () => {
    const job = join(dir, "job.txt");
    writeFileSync(job, "We need TypeScript, Kubernetes and Terraform experience.");
    const argv = ["check", resumePath, "--job", job];

    expect(await main(argv, context())).toBe(0);
    const plain = out.join("\n");
    expect(plain).not.toMatch(HAS_ESCAPE);

    out = [];
    for (const depth of [4, 8, 24] as const) {
      expect(
        await main(argv, context({ terminal: { depth, interactive: false, columns: 80 } })),
      ).toBe(0);
      const coloured = out.join("\n");
      expect(coloured).toMatch(HAS_ESCAPE);
      expect(strip(coloured)).toBe(plain);
      out = [];
    }
  });
});

describe("banner", () => {
  it("draws the wordmark with the version when the terminal is wide enough", () => {
    const text = strip(banner(WIDE));
    expect(text.split("\n")).toHaveLength(8);
    expect(text).toContain("██╗   ██╗███████╗██████╗");
    expect(text).toContain(`ATS Engine v${ENGINE_VERSION}`);
    expect(text).toContain("veriworkly.com");
    expect(Math.max(...text.split("\n").map((line) => line.length))).toBeLessThanOrEqual(80);
  });

  it("falls back to one line at 80 columns or fewer", () => {
    const text = strip(banner({ ...WIDE, columns: 80 }));
    expect(text.trim()).toBe(`VERIWORKLY  ATS Engine v${ENGINE_VERSION}`);
  });

  it("has no escapes without colour", () => {
    expect(banner({ ...WIDE, depth: 1 })).not.toMatch(HAS_ESCAPE);
  });

  it("is printed above the report and the help, but only to an interactive terminal", async () => {
    expect(await main(["check", resumePath], context({ terminal: WIDE }))).toBe(0);
    expect(strip(out[0]!)).toContain("██╗   ██╗");
    expect(strip(out[1]!)).toMatch(/^Readiness {2}\d+\/100/);

    out = [];
    expect(await main(["--help"], context({ terminal: WIDE }))).toBe(0);
    expect(strip(out.join("\n"))).toMatch(/██╗[\s\S]*Usage: ats-engine check/);

    out = [];
    expect(await main(["check", resumePath], context())).toBe(0);
    expect(out.join("\n")).not.toContain("██");
  });

  it("never touches --json, even in a colour terminal", async () => {
    expect(await main(["check", resumePath, "--json"], context({ terminal: WIDE }))).toBe(0);
    const printed = out.join("\n");
    expect(printed).not.toMatch(HAS_ESCAPE);
    expect(JSON.parse(printed).readinessScore).toEqual(expect.any(Number));
  });
});

describe("--ai configuration", () => {
  it.each([
    [{}, {}, /needs a provider/],
    [{ provider: "watson" }, {}, /Unknown provider "watson"/],
    [{ provider: "gemini" }, { GEMINI_API_KEY: "k" }, /needs a model/],
    [{ provider: "gemini", model: "m" }, {}, /set GEMINI_API_KEY or ATS_AI_API_KEY/],
    [{ provider: "openai-compatible", model: "m" }, { ATS_AI_API_KEY: "k" }, /needs --base-url/],
    [
      { provider: "openai", model: "m", "base-url": "ftp://x" },
      { OPENAI_API_KEY: "k" },
      /http or https/,
    ],
    [
      { provider: "openai", model: "m", "base-url": "not a url" },
      { OPENAI_API_KEY: "k" },
      /not a URL/,
    ],
    [
      { provider: "openai", model: "m", "max-tokens": "1.5" },
      { OPENAI_API_KEY: "k" },
      /--max-tokens/,
    ],
    [
      { provider: "openai", model: "m", "max-tokens": "0" },
      { OPENAI_API_KEY: "k" },
      /--max-tokens/,
    ],
  ])("refuses %j with %j", (flags, env, message) => {
    expect(() => resolveAiConfig(flags, env)).toThrow(message);
  });

  it("does not take a provider's name from the prototype", () => {
    expect(() => resolveAiConfig({ provider: "constructor", model: "m" }, {})).toThrow(
      /Unknown provider/,
    );
  });

  it("fills in each preset's endpoint and key variable", () => {
    expect(resolveAiConfig({ provider: "Gemini", model: "m" }, { GEMINI_API_KEY: "g" })).toEqual({
      provider: "gemini",
      adapter: "openai-compatible",
      model: "m",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
      host: "generativelanguage.googleapis.com",
      maxTokens: 8000,
      timeoutMs: 120_000,
      apiKey: "g",
    });
    expect(
      resolveAiConfig({ provider: "anthropic", model: "m" }, { ANTHROPIC_API_KEY: "a" }).adapter,
    ).toBe("anthropic");
    expect(
      resolveAiConfig({ provider: "openai", model: "m" }, { OPENAI_API_KEY: "o" }).baseUrl,
    ).toBe(undefined);
  });

  it("prefers the provider's own key, flags over variables, and reads everything from variables", () => {
    const env = {
      ATS_AI_PROVIDER: "openrouter",
      ATS_AI_MODEL: "env-model",
      ATS_AI_MAX_TOKENS: "1234",
      ATS_AI_API_KEY: "shared",
      OPENROUTER_API_KEY: "own",
    };
    // A shared key set for one provider must not be sent to another that has its own.
    expect(resolveAiConfig({}, env)).toMatchObject({
      provider: "openrouter",
      model: "env-model",
      maxTokens: 1234,
      apiKey: "own",
    });
    expect(resolveAiConfig({}, { ...env, OPENROUTER_API_KEY: undefined }).apiKey).toBe("shared");
    expect(resolveAiConfig({ model: "flag-model", "max-tokens": "99" }, env)).toMatchObject({
      model: "flag-model",
      maxTokens: 99,
    });
  });

  it("needs no key for Ollama or another server on this machine", () => {
    expect(resolveAiConfig({ provider: "ollama", model: "llama" }, {}).baseUrl).toBe(
      "http://localhost:11434/v1",
    );
    expect(
      resolveAiConfig({ "base-url": "http://127.0.0.1:8000/v1", model: "m" }, {}),
    ).toMatchObject({ provider: "openai-compatible", baseUrl: "http://127.0.0.1:8000/v1" });
    expect(() =>
      resolveAiConfig({ "base-url": "https://llm.example.com/v1", model: "m" }, {}),
    ).toThrow(/No API key/);
  });

  it("refuses AI flags without --ai, and fails before reading the resume", async () => {
    expect(await main(["check", resumePath, "--model", "m"], context())).toBe(1);
    expect(err.join("\n")).toMatch(/--model needs --ai/);

    err = [];
    expect(await main(["check", "missing.txt", "--ai", "--provider", "gemini"], context())).toBe(1);
    expect(err.join("\n")).toMatch(/needs a model/);
  });
});

const INSIGHTS = {
  explanation: "The resume reads cleanly.\n\nThe role history is clear.",
  missingEvidence: ["No team size for the senior role"],
  keywordOpportunities: ["Kubernetes"],
  recommendedImprovements: ["Quantify the payment work"],
  priorityOrder: ["Add a summary", "Quantify the payment work"],
};

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function fakeFetch(reply: (call: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, headers: init.headers, body: JSON.parse(init.body) };
    calls.push(call);
    const { status = 200, body } = reply(call);
    return { ok: status < 400, status, text: async () => JSON.stringify(body) };
  };
  return { fetch, calls };
}

const chatReply = (content: unknown) => ({
  body: {
    id: "chatcmpl-1",
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }],
    usage: { prompt_tokens: 900, completion_tokens: 120 },
  },
});

describe("--ai", () => {
  it("analyses through Gemini's endpoint, without sending the candidate's contact details", async () => {
    const { fetch, calls } = fakeFetch(() => chatReply(INSIGHTS));
    const code = await main(
      ["check", resumePath, "--ai", "--provider", "gemini", "--model", "gemini-test"],
      context({ env: { GEMINI_API_KEY: "secret-gemini-key" }, fetch }),
    );
    expect(code).toBe(0);

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call!.url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    );
    expect(call!.headers.authorization).toBe("Bearer secret-gemini-key");
    expect(call!.body.model).toBe("gemini-test");
    expect(call!.body.max_tokens).toBe(8000);
    const sent = JSON.stringify(call!.body.messages);
    expect(sent).toContain("Acme Corporation");
    expect(sent).not.toContain("jane.doe@example.com");
    expect(sent).not.toContain("555-0199");

    const printed = out.join("\n");
    expect(printed).toMatch(/^Readiness/);
    expect(printed).toContain("AI analysis (gemini, gemini-test)");
    expect(printed).toContain("  The resume reads cleanly.\n\n  The role history is clear.");
    expect(printed).toContain("Do first\n    1. Add a summary\n    2. Quantify the payment work");
    // No posting, so no keyword suggestion can point at one: it is dropped and counted.
    expect(printed).not.toContain("Keywords to consider");
    expect(printed).toContain("1 suggestion dropped");
    expect(printed).toContain("900 tokens in, 120 out");
    expect(err.join("\n")).toMatch(
      /Sending the resume to gemini at generativelanguage\.googleapis\.com \(gemini-test\)/,
    );
    expect([...out, ...err].join("\n")).not.toContain("secret-gemini-key");
  });

  it("talks to Anthropic's Messages API with the Anthropic preset", async () => {
    const { fetch, calls } = fakeFetch(() => ({
      body: {
        id: "msg_1",
        content: [{ type: "text", text: JSON.stringify(INSIGHTS) }],
        stop_reason: "end_turn",
        usage: { input_tokens: 800, output_tokens: 100 },
      },
    }));
    const code = await main(
      ["check", resumePath, "--ai", "--provider", "anthropic", "--model", "claude-test"],
      context({ env: { ANTHROPIC_API_KEY: "secret-anthropic-key" }, fetch }),
    );
    expect(code).toBe(0);
    expect(calls[0]!.url).toBe("https://api.anthropic.com/v1/messages");
    expect(calls[0]!.headers["x-api-key"]).toBe("secret-anthropic-key");
    expect(out.join("\n")).toContain("AI analysis (anthropic, claude-test)");
  });

  it("adds the analysis to --json as one document", async () => {
    const { fetch } = fakeFetch(() => chatReply(INSIGHTS));
    const code = await main(
      ["check", resumePath, "--json", "--ai", "--provider", "ollama", "--model", "llama"],
      context({ fetch }),
    );
    expect(code).toBe(0);
    const report = JSON.parse(out.join("\n"));
    expect(report.readinessScore).toEqual(expect.any(Number));
    expect(report.ai).toMatchObject({
      provider: "ollama",
      model: "llama",
      insights: { priorityOrder: INSIGHTS.priorityOrder },
      usage: { inputTokens: 900, outputTokens: 120 },
      attempts: 1,
    });
  });

  it("prints the report, then explains a rejected key, and exits 1", async () => {
    const { fetch } = fakeFetch(() => ({ status: 401, body: { error: "bad key" } }));
    const code = await main(
      ["check", resumePath, "--ai", "--provider", "openai", "--model", "gpt-test"],
      context({ env: { OPENAI_API_KEY: "k" }, fetch }),
    );
    expect(code).toBe(1);
    expect(out.join("\n")).toMatch(/^Readiness/);
    expect(err.join("\n")).toMatch(/openai \(gpt-test\) rejected the API key \(HTTP 401\)/);
  });

  it("points at --max-tokens when the reply is cut off", async () => {
    const { fetch } = fakeFetch(() => ({
      body: { choices: [{ finish_reason: "length", message: { content: '{"explanation": "Th' } }] },
    }));
    const code = await main(
      ["check", resumePath, "--ai", "--provider", "groq", "--model", "m", "--max-tokens", "50"],
      context({ env: { GROQ_API_KEY: "k" }, fetch }),
    );
    expect(code).toBe(1);
    expect(err.join("\n")).toMatch(/Raise --max-tokens \(now 50\)/);
  });

  it("still gates on --min-score when the analysis succeeds", async () => {
    const { fetch } = fakeFetch(() => chatReply(INSIGHTS));
    const code = await main(
      ["check", resumePath, "--min-score", "100", "--ai", "--provider", "ollama", "--model", "m"],
      context({ fetch }),
    );
    expect(code).toBe(2);
  });
});

describe("--timeout", () => {
  const env = { GEMINI_API_KEY: "g" };
  const args = ["check", resumePath, "--ai", "--provider", "gemini", "--model", "m"];

  /** A provider that never answers, and lets go only when the request is aborted. */
  const silent = (): { fetch: FetchLike; calls: () => number } => {
    let calls = 0;
    const fetch: FetchLike = (_url, init) => {
      calls += 1;
      return new Promise((_resolve, reject) => {
        const signal = init.signal as unknown as AbortSignal;
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };
    return { fetch, calls: () => calls };
  };

  it("defaults to 120 s in all, and reads --timeout or ATS_AI_TIMEOUT in seconds", () => {
    expect(resolveAiConfig({ provider: "gemini", model: "m" }, env).timeoutMs).toBe(120_000);
    expect(
      resolveAiConfig({ provider: "gemini", model: "m" }, { ...env, ATS_AI_TIMEOUT: "45" })
        .timeoutMs,
    ).toBe(45_000);
    expect(
      resolveAiConfig(
        { provider: "gemini", model: "m", timeout: "300" },
        { ...env, ATS_AI_TIMEOUT: "45" },
      ).timeoutMs,
    ).toBe(300_000);
  });

  it.each(["0", "-5", "abc", "", "Infinity", "1e9"])("refuses --timeout %j", (value) => {
    expect(() => resolveAiConfig({ provider: "gemini", model: "m", timeout: value }, env)).toThrow(
      "--timeout must be a number of seconds, more than 0 and at most 3600.",
    );
  });

  it("needs --ai", async () => {
    expect(await main(["check", resumePath, "--timeout", "30"], context())).toBe(1);
    expect(err.join("\n")).toContain("--timeout needs --ai.");
  });

  it("stops waiting for a provider that never answers at the deadline, retries included", async () => {
    const provider = silent();
    const started = performance.now();
    const code = await main(
      [...args, "--timeout", "0.05"],
      context({ env, fetch: provider.fetch }),
    );
    expect(code).toBe(1);
    // The report still printed; the AI part failed within its total budget, not 2 × 120 s.
    expect(out.join("\n")).toContain("Readiness");
    expect(performance.now() - started).toBeLessThan(5_000);
    // The deadline covers the retry too: the call that timed out is not made again.
    expect(provider.calls()).toBe(1);
    expect(err.join("\n")).toContain(
      "No answer from gemini at generativelanguage.googleapis.com within 0.05 s. Raise --timeout",
    );
  });
});
