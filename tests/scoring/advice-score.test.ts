import { describe, expect, it } from "vitest";

import { AtsScoringService, DEFAULT_POLICY, type AtsReport } from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";

/**
 * Advice never moves a score: the same resume scores byte for byte the same whether or not the
 * call carries anything that produces advice — a badly named, oversized, encrypted file with
 * tracked changes, a target ATS, an old graduation year read in a region that advises on it.
 */

const NOW = new Date("2026-10-01T00:00:00Z");
const POLICY = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
const RESUME = `Jane Doe
jane.doe@example.com | +1 415 555 0199
Engineering leader with 30+ years of experience in payments.
Experience
Senior Engineer, Acme Corporation    Mar 1995 – Present
• Built payment systems in TypeScript, cutting failures by 40%
• Led a team of 5 engineers through the move to Kubernetes
Education
BSc Computer Science, State University, 1994
Skills
TypeScript, Go, PostgreSQL`;
const LAYOUT = { columnRatio: 0, tableCount: 0, pageCount: 1 };

/** Everything in a report except the advice. */
const scored = ({ advice: _advice, ...rest }: AtsReport) => JSON.stringify(rest);

describe("advice and the score", () => {
  it("leaves the score, categories, failed checks and fixes byte-identical", () => {
    const plain = AtsScoringService.check(RESUME, POLICY, { now: NOW, layout: LAYOUT });
    const advised = AtsScoringService.check(RESUME, POLICY, {
      now: NOW,
      layout: { ...LAYOUT, encrypted: true, trackedChanges: 4, comments: 2 },
      file: { name: "Resume_final_v3 (2).pdf", bytes: 9 * 1024 * 1024, passwordProtected: true },
      targetAts: "greenhouse",
    });

    expect(plain.locale.region).toBe("US");
    expect(plain.advice.map((item) => item.id)).toEqual([
      "age.graduationYear",
      "age.experienceYears",
    ]);
    expect(advised.advice.length).toBeGreaterThan(8);
    expect(scored(advised)).toBe(scored(plain));
    for (const field of [
      "readinessScore",
      "categories",
      "failedChecks",
      "prioritizedFixes",
      "rules",
    ] as const)
      expect(JSON.stringify(advised[field])).toBe(JSON.stringify(plain[field]));
  });

  it("scores the same as in a region that gives no age advice", () => {
    const us = AtsScoringService.check(RESUME, POLICY, { now: NOW, region: "US" });
    expect(us.advice.length).toBeGreaterThan(0);
    // The age thresholds are the only difference the advice makes; the rules are the region's.
    const withoutAge = withLocales(DEFAULT_POLICY, {
      regions: BUILT_IN_LOCALES.regions.map((pack) =>
        pack.id === "US" ? { ...pack, ageAdvice: undefined } : pack,
      ),
    });
    const quiet = AtsScoringService.check(RESUME, withoutAge, { now: NOW, region: "US" });
    expect(quiet.advice).toEqual([]);
    expect(quiet.readinessScore).toBe(us.readinessScore);
    expect(JSON.stringify(quiet.rules)).toBe(JSON.stringify(us.rules));
  });
});
