import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { parseAtsPolicy, type AtsEnginePolicy } from "../../src/index.js";

/**
 * The real, private, gitignored scoring policy, or `null` when absent. Resolved from this file,
 * not the working directory. Suites using it skip when it is absent; `livePolicyLoadError` lets a
 * suite prove it is running rather than quietly skipping.
 */
// `ATS_ENGINE_POLICY` points at it from anywhere; the default is the monorepo's .private folder.
const policyPath =
  process.env.ATS_ENGINE_POLICY ??
  fileURLToPath(new URL("../../../../.private/ats-engine-policy.dev.json", import.meta.url));

let policy: AtsEnginePolicy | null = null;
let loadError: string | null = null;

try {
  policy = parseAtsPolicy(JSON.parse(readFileSync(policyPath, "utf8")));
} catch (error) {
  loadError = error instanceof Error ? error.message : String(error);
}

export const livePolicy = policy;
export const livePolicyPath = policyPath;
export const livePolicyLoadError = loadError;
