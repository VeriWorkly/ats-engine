import type { AtsLanguagePack } from "../locales/schema.js";
import { canonicalJson, fnv1a } from "../util/hash.js";
import type { AtsEnginePolicy } from "./schema.js";

/**
 * Names the exact policy a report was scored with: its version and a hash of its content. The
 * same fingerprint, engine version, input and reference date give an identical report.
 *
 * Hashed as applied, after locale packs, without the attached packs themselves (their
 * contribution is already merged in). Not memoised: a copy of a frozen policy can still change.
 */
export function policyFingerprint(policy: AtsEnginePolicy): string {
  return appliedFingerprint(policy, []);
}

/**
 * The fingerprint of a policy as one resume was read with it: also the detection words of the
 * language packs it was read in, which decide what each language governs (its bullets, its
 * rules) beyond the vocabulary merged in. Sorted, so the order packs are attached in is not.
 */
export function appliedFingerprint(policy: AtsEnginePolicy, read: readonly AtsLanguagePack[]) {
  const { locales: _attached, ...applied } = policy;
  const detection = [...read]
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(({ id, script, detectionWords }) => ({ id, script, detectionWords }));
  const hashed = detection.length ? { ...applied, detection } : applied;
  return `${policy.version}+${fnv1a(canonicalJson(hashed))}`;
}
