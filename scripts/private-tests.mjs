// The tests that score against the private policy (tests/fixtures/livePolicy.ts). CI has no copy
// of it, so they skip there; this runs them as a release step, on a checkout that has it, and
// says so plainly where it does not.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const policy =
  process.env.ATS_ENGINE_POLICY ??
  fileURLToPath(new URL("../.private/ats-engine-policy.dev.json", import.meta.url));
if (!existsSync(policy)) {
  console.log(`No private policy at ${policy}: the private-policy tests were not run.`);
  process.exit(0);
}
const run = spawnSync(
  "npx vitest run tests/scoring/live-policy.test.ts tests/integration/regressions.test.ts",
  { stdio: "inherit", shell: true },
);
process.exit(run.status ?? 1);
