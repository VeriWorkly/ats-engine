import type { AtsReport } from "../types.js";

export type AtsVerdict = "strong" | "needs-work" | "weak";

/**
 * The lower bounds of "strong" and "needs-work", on whichever score the verdict reads. The one
 * set of thresholds a report is judged by: anything that colours or labels a score (the CLI, a
 * host's UI) should read these, or `computeVerdict` itself, rather than keep bands of its own.
 */
export const VERDICT_BANDS = { strong: 75, needsWork: 45 } as const;

/**
 * Job match matters more than raw formatting once a target role is on the table — unless the
 * resume was caught gaming the screener (an integrity rule of error severity failed). Then the
 * match is no evidence of fit, since a pasted posting or an instruction to an AI is what produced
 * it, and the verdict is held to the readiness score that already carries the deduction.
 */
export function computeVerdict(report: AtsReport): AtsVerdict {
  // Only the tricks that can raise a match — an instruction, hidden text, a pasted posting — are
  // errors; a stray zero-width space pasted from the web is a warning and costs no verdict.
  const caught = report.failedChecks.some(
    (rule) => rule.category === "integrity" && rule.severity === "error",
  );
  const primary =
    report.jobMatchScore === null
      ? report.readinessScore
      : caught
        ? Math.min(report.jobMatchScore, report.readinessScore)
        : report.jobMatchScore;
  if (primary >= VERDICT_BANDS.strong) return "strong";
  if (primary >= VERDICT_BANDS.needsWork) return "needs-work";
  return "weak";
}
