import { describe, expect, it } from "vitest";

import { AtsScoringService, check, DEFAULT_POLICY, parseAtsPolicy } from "../src/index.js";

const RESUME = [
  "Jane Doe",
  "jane.doe@example.com | (415) 555-0199",
  "",
  "Experience",
  "Senior Engineer, Acme Corporation",
  "Jan 2020 - Present",
  "- Built payment systems in TypeScript, cutting failures 40%.",
  "",
  "Education",
  "BSc Computer Science, State University, 2015",
  "",
  "Skills",
  "TypeScript, Go, PostgreSQL",
].join("\n");

const now = new Date("2026-10-01T00:00:00Z");

describe("check()", () => {
  it("scores with the default policy when none is given", () => {
    expect(check(RESUME, undefined, { now })).toEqual(
      AtsScoringService.check(RESUME, DEFAULT_POLICY, { now }),
    );
  });

  it("gives the same report as AtsScoringService.check for a policy and options", () => {
    const policy = parseAtsPolicy({ ...DEFAULT_POLICY, version: "custom" });
    const options = { now, jobDescription: "Senior engineer with TypeScript and Kubernetes." };
    expect(check(RESUME, policy, options)).toEqual(
      AtsScoringService.check(RESUME, policy, options),
    );
  });
});
