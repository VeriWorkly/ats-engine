import { expect } from "vitest";

/**
 * Asserts that `run` finishes within `budgetMs`. A catastrophic regex is slow on every run, a
 * busy machine only at random, so a run over budget is retried up to `attempts` times and the
 * fastest is judged. Returns what the last run returned.
 */
export function expectFast<T>(run: () => T, budgetMs: number, label?: string, attempts = 3): T {
  let fastest = Number.POSITIVE_INFINITY;
  let result!: T;
  for (let attempt = 0; attempt < attempts && fastest >= budgetMs; attempt += 1) {
    const started = performance.now();
    result = run();
    fastest = Math.min(fastest, performance.now() - started);
  }
  expect(fastest, label).toBeLessThan(budgetMs);
  return result;
}

/** `expectFast` for async work. */
export async function expectFastAsync<T>(
  run: () => Promise<T>,
  budgetMs: number,
  label?: string,
  attempts = 3,
): Promise<T> {
  let fastest = Number.POSITIVE_INFINITY;
  let result!: T;
  for (let attempt = 0; attempt < attempts && fastest >= budgetMs; attempt += 1) {
    const started = performance.now();
    result = await run();
    fastest = Math.min(fastest, performance.now() - started);
  }
  expect(fastest, label).toBeLessThan(budgetMs);
  return result;
}
