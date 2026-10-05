import { expect } from "vitest";

/**
 * Asserts that `run` finishes within `budgetMs`, without failing because the machine was busy.
 *
 * A wall-clock budget is how these tests catch a regex that backtracks catastrophically, and
 * that kind of slowness is the same on every run. A loaded CI runner or a parallel test worker
 * makes one run slow at random. So a run over budget is timed again, up to `attempts` times in
 * all, and the fastest run is the one judged: noise cannot fail the test, a real regression
 * still does.
 *
 * Returns what the last run returned, so a test can also check the result.
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
