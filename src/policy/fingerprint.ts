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
  const { locales: _attached, ...applied } = policy;
  return `${policy.version}+${fnv1a(canonicalJson(applied))}`;
}
