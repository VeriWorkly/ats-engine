/**
 * @veriworkly/ats-engine/ai/testing — test doubles and an eval harness for the AI tasks.
 *
 * `scriptedProvider` replays canned replies, for unit tests and for checking prompt overrides
 * without a network. `runAiEval` measures what matters about a provider + prompt combination:
 * does the output parse, does it stay grounded, does it invent numbers, is it stable, and does
 * a resume that tries to give the model instructions get its way.
 */

import type { AtsAi } from "../index.js";
import type { LlmProvider, LlmRequest, LlmResponse } from "../provider.js";
import type { AtsAiResult } from "../run.js";
import { AtsAiError } from "../run.js";

/**
 * One scripted answer: the response text, a partial response, an error to throw, or a function
 * of the request.
 */
export type ScriptedReply =
  string | Partial<LlmResponse> | Error | ((request: LlmRequest) => string | Partial<LlmResponse>);

/** A provider that answers from a script and records every request. */
export type ScriptedProvider = LlmProvider & {
  /** Every request received, in order. */
  readonly calls: LlmRequest[];
};

/**
 * A provider that answers from a script, one reply per call; the last reply repeats once the
 * script runs out. A string is the response text, an `Error` is thrown, a function is called
 * with the request.
 */
export function scriptedProvider(...replies: ScriptedReply[]): ScriptedProvider {
  if (!replies.length) throw new Error("scriptedProvider needs at least one reply.");
  const calls: LlmRequest[] = [];
  return {
    calls,
    async complete(request) {
      calls.push(request);
      const next = replies[Math.min(calls.length, replies.length) - 1];
      const reply = typeof next === "function" ? next(request) : next;
      if (reply instanceof Error) throw reply;
      const response = typeof reply === "string" ? { text: reply } : reply;
      return { text: "", finish: "stop", id: `scripted-${calls.length}`, ...response };
    },
  };
}

/** One case of an eval: the task to run, the text it may draw on, values it must never output. */
export type AiEvalCase = {
  id: string;
  /** Runs the task under test. `ai` is the instance passed to `runAiEval`. */
  run(ai: AtsAi): Promise<AtsAiResult<unknown>>;
  /**
   * Text the output may legitimately draw numbers from: everything the task is given — the
   * resume, the posting, and for `analyze` the report (`JSON.stringify(report)` will do).
   */
  source: string;
  /** Values that must never appear in the output, e.g. an employer a resume tries to inject. */
  forbidden?: string[];
};

/** The rates an eval measured over every run of every case, with each failure and dropped value. */
export type AiEvalReport = {
  runs: number;
  /** Share of runs that produced a schema-valid result. */
  schemaValidRate: number;
  /** Share of successful runs that returned at least one ungrounded value (which was dropped). */
  groundingViolationRate: number;
  /** Share of successful runs whose kept output holds a number that is not in the source. */
  fabricatedNumberRate: number;
  /** Share of successful runs that reproduced their case's first result exactly. */
  consistency: number;
  /** Share of successful runs whose kept output contains a forbidden value. */
  forbiddenLeakRate: number;
  failures: Array<{ id: string; run: number; code: string; message: string }>;
  /** Every value grounding dropped, so a reviewer can tell a caught fabrication from a false drop. */
  rejected: Array<{ id: string; run: number; path: string; value: string }>;
};

const NUMBER = /\d+(?:[.,]\d+)*/g;

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

/** A year and month written as ISO does ("2019-03", "2019-03-01"). */
const ISO_MONTH = /(?<!\d)(\d{4})-(0[1-9]|1[0-2])(?!\d)/g;

/**
 * Numbers in the output that the source never states. The month of an ISO date whose year the
 * source states is not one: conversion writes "Mar 2019" as "2019-03".
 */
export function fabricatedNumbers(output: unknown, source: string): string[] {
  const known = new Set(source.match(NUMBER) ?? []);
  const numbers = (text: string) =>
    text.replace(ISO_MONTH, (date, year: string) => (known.has(year) ? year : date)).match(NUMBER);
  return strings(output).flatMap((text) => (numbers(text) ?? []).filter((n) => !known.has(n)));
}

const rate = (count: number, total: number) => (total ? count / total : 0);

/**
 * Runs every case `runs` times (default 1) and measures schema-valid output, grounding, numbers
 * not in the source, consistency between runs, and leaks of forbidden values.
 */
export async function runAiEval(
  ai: AtsAi,
  cases: AiEvalCase[],
  { runs = 1 }: { runs?: number } = {},
): Promise<AiEvalReport> {
  let attempted = 0;
  let succeeded = 0;
  let violating = 0;
  let fabricating = 0;
  let consistent = 0;
  let leaking = 0;
  const failures: AiEvalReport["failures"] = [];
  const rejected: AiEvalReport["rejected"] = [];

  for (const testCase of cases) {
    let first: string | undefined;
    for (let run = 1; run <= runs; run += 1) {
      attempted += 1;
      let outcome: AtsAiResult<unknown>;
      try {
        outcome = await testCase.run(ai);
      } catch (error) {
        const code = error instanceof AtsAiError ? error.code : "error";
        const message = error instanceof Error ? error.message : String(error);
        failures.push({ id: testCase.id, run, code, message });
        continue;
      }

      succeeded += 1;
      const serialized = JSON.stringify(outcome.result);
      first ??= serialized;
      if (serialized === first) consistent += 1;
      if (outcome.rejected.length) violating += 1;
      for (const { path, value } of outcome.rejected)
        rejected.push({ id: testCase.id, run, path, value });
      if (fabricatedNumbers(outcome.result, testCase.source).length) fabricating += 1;
      const output = serialized.toLowerCase();
      if (testCase.forbidden?.some((value) => output.includes(value.toLowerCase()))) leaking += 1;
    }
  }

  return {
    runs: attempted,
    schemaValidRate: rate(succeeded, attempted),
    groundingViolationRate: rate(violating, succeeded),
    fabricatedNumberRate: rate(fabricating, succeeded),
    consistency: rate(consistent, succeeded),
    forbiddenLeakRate: rate(leaking, succeeded),
    failures,
    rejected,
  };
}
