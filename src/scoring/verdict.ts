import type { AtsReport, AtsRuleResult } from "../types.js";

/** The one-word reading of a report: `computeVerdict`. */
export type AtsVerdict = "strong" | "needs-work" | "weak";

/** The lower bounds of "strong" and "needs-work" on the score the verdict reads. */
export const VERDICT_BANDS = /* @__PURE__ */ Object.freeze({ strong: 75, needsWork: 45 } as const);

/** Whether an error-severity integrity rule failed; a stray zero-width space is only a warning. */
export const caughtGaming = (failedChecks: readonly AtsRuleResult[]) =>
  failedChecks.some((rule) => rule.category === "integrity" && rule.severity === "error");

/**
 * The one-word reading of a report. With a target role the job match decides, unless an
 * error-severity integrity rule failed: then the match is no evidence of fit and the verdict is
 * held to the lower of match and readiness.
 */
export function computeVerdict(report: AtsReport): AtsVerdict {
  const primary =
    report.jobMatchScore === null
      ? report.readinessScore
      : caughtGaming(report.failedChecks)
        ? Math.min(report.jobMatchScore, report.readinessScore)
        : report.jobMatchScore;
  if (primary >= VERDICT_BANDS.strong) return "strong";
  if (primary >= VERDICT_BANDS.needsWork) return "needs-work";
  return "weak";
}
