import { describe, expect, it } from "vitest";

import { AtsPolicyError, DEFAULT_POLICY, parseAtsPolicy } from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";

/**
 * The advice section of the policy: file-name words, the size limit, the target-ATS notes and
 * every message, with defaults, so a policy written before it still parses; and the region
 * packs' age thresholds, which turn age advice on where a region asks for it.
 */

describe("policy.advice", () => {
  it("defaults in a policy written before it", () => {
    const { advice: _advice, ...older } = DEFAULT_POLICY;
    const parsed = parseAtsPolicy(older);
    expect(parsed.advice.file.maxBytes).toBe(2 * 1024 * 1024);
    expect(parsed.advice.age.graduationYears).toBeUndefined();
    expect(Object.keys(parsed.advice.targets).sort()).toEqual(["greenhouse", "lever", "taleo"]);
  });

  it("refuses a file-name word list that is not a valid pattern", () => {
    expect(() =>
      parseAtsPolicy({
        ...DEFAULT_POLICY,
        advice: {
          ...DEFAULT_POLICY.advice,
          file: { ...DEFAULT_POLICY.advice.file, draftMarks: ["("] },
        },
      }),
    ).toThrow(AtsPolicyError);
  });
});

describe("region ageAdvice", () => {
  it("is set for the US only among the bundled regions", () => {
    const byId = Object.fromEntries(BUILT_IN_LOCALES.regions.map((pack) => [pack.id, pack]));
    expect(byId.US!.ageAdvice).toEqual({ graduationYears: 20, experienceYears: 20 });
    expect(byId.DE!.ageAdvice).toBeUndefined();
    expect(byId.IN!.ageAdvice).toBeUndefined();
  });

  it("refuses a threshold that is not a positive whole number of years", () => {
    const [US] = BUILT_IN_LOCALES.regions;
    expect(() =>
      withLocales(DEFAULT_POLICY, { regions: [{ ...US!, ageAdvice: { graduationYears: -1 } }] }),
    ).toThrow(AtsPolicyError);
  });
});
