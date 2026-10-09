import type { AtsResumeInput, PreparedResume } from "./input.js";
import { DEFAULT_POLICY } from "./policy/default.js";
import type { AtsEnginePolicy } from "./policy/schema.js";
import { AtsScoringService, type AtsCheckOptions } from "./scoring/engine.js";
import type { AtsReport } from "./types.js";

/**
 * Scores a resume against a policy: the bundled default when none is given.
 *
 * The report is a pure function of (resume, policy, options); pass `options.now` to pin the
 * date that tenure and recency are counted to. `resume` may be raw input or a `PreparedResume`.
 * Throws `AtsInputError` for a structured document that fails validation, and `AtsPolicyError`
 * for a `region` or `targetAts` the policy does not have.
 *
 * `AtsScoringService.check` gives the same report, and stays until 1.0.
 */
export function check(
  resume: AtsResumeInput | PreparedResume,
  policy: AtsEnginePolicy = DEFAULT_POLICY,
  options: AtsCheckOptions = {},
): AtsReport {
  return AtsScoringService.check(resume, policy, options);
}
