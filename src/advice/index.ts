import { AtsPolicyError } from "../policy/errors.js";
import type { AtsEnginePolicy } from "../policy/schema.js";
import { own } from "../util/own.js";
import type { AtsAdvice, AtsFileInfo, AtsLayoutSignals, AtsParsedResume } from "../types.js";
import { ageAdvice } from "./age.js";
import { fileAdvice } from "./file.js";

/**
 * The report's `advice`: what is worth knowing and is not scored. Read after the score is final
 * and from nothing the score reads back, so no advice can move it.
 */

/**
 * The target ATS a caller named, by its id in the policy (any case), or null when none was named.
 * Refused when the policy has no notes on it, rather than answered with silence that would read
 * as "nothing to know".
 */
export function targetOf(policy: AtsEnginePolicy, targetAts: unknown) {
  if (targetAts === undefined || targetAts === null || targetAts === "") return null;
  const id = String(targetAts).toLowerCase();
  const target = own(policy.advice.targets, id);
  if (target) return { id, ...target };
  const known = Object.keys(policy.advice.targets).join(", ") || "none";
  throw new AtsPolicyError(`No notes on the ATS "${String(targetAts)}" (known: ${known}).`, [
    { path: "advice.targets", message: `no target with id "${id}"` },
  ]);
}

export function adviceFor(
  policy: AtsEnginePolicy,
  input: {
    parsed: AtsParsedResume;
    lines: readonly string[];
    now: Date;
    file?: AtsFileInfo;
    layout?: AtsLayoutSignals;
    target: ReturnType<typeof targetOf>;
  },
): AtsAdvice[] {
  const { parsed, lines, now, file, layout, target } = input;
  return [
    ...fileAdvice(policy, file, layout, parsed.name),
    ...ageAdvice(policy, parsed, lines, now),
    ...(target?.notes ?? []).map((note) => ({
      id: `ats.${target!.id}.${note.id}`,
      kind: "ats" as const,
      message: note.message,
      source: note.source,
    })),
  ];
}
