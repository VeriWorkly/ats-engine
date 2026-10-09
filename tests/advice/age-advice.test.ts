import { describe, expect, it } from "vitest";

import { AtsScoringService, DEFAULT_POLICY, type AtsReport } from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import { expectFast } from "../fixtures/timing.js";

/**
 * Age signals: dates and totals that let a reader work out a candidate's age. Advice where the
 * region pack says so (the US, where age bias is the concern and recruiters expect no age on a
 * resume), never in Germany or India, where a date of birth is customary; never a score change.
 */

const NOW = new Date("2026-10-01T00:00:00Z");
const POLICY = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);

const resume = ({ graduated = 2015, start = "Jan 2016", summary = "" } = {}) => `Jane Doe
jane.doe@example.com | (415) 555-0199
${summary}
Experience
Senior Engineer, Acme Corporation    ${start} – Present
• Built payment systems in TypeScript, cutting failures by 40%
• Led a team of 5 engineers through the move to Kubernetes
Education
BSc Computer Science, State University, ${graduated}
Skills
TypeScript, Go, PostgreSQL`;

const check = (text: string, region?: string): AtsReport =>
  AtsScoringService.check(text, POLICY, { now: NOW, region });
const advice = (report: AtsReport, id: string) => report.advice.find((item) => item.id === id);

describe("graduation year", () => {
  it("advises in the US when a graduation year is more than 20 years back", () => {
    const item = advice(check(resume({ graduated: 1998 }), "US"), "age.graduationYear");
    expect(item).toMatchObject({ kind: "age", evidence: "Education dated 1998." });
    expect(item!.message).toMatch(/age bias/);
    expect(item!.message).toMatch(/15 years/);
  });

  it("is quiet for a recent one, at the threshold, and for an expected one", () => {
    expect(advice(check(resume({ graduated: 2015 }), "US"), "age.graduationYear")).toBeUndefined();
    expect(advice(check(resume({ graduated: 2006 }), "US"), "age.graduationYear")).toBeUndefined();
    expect(advice(check(resume({ graduated: 2028 }), "US"), "age.graduationYear")).toBeUndefined();
  });

  it.each(["DE", "IN"])("is not given in %s, where an age on a resume is customary", (region) => {
    expect(check(resume({ graduated: 1990 }), region).advice).toEqual([]);
  });

  it("is not given without a region", () => {
    const report = AtsScoringService.check(resume({ graduated: 1990 }), DEFAULT_POLICY, {
      now: NOW,
    });
    expect(report.locale.region).toBeNull();
    expect(report.advice).toEqual([]);
  });
});

describe("years of experience", () => {
  it("advises on a stated total past the threshold, quoting it", () => {
    const summary = "Engineering leader with 30+ years of experience in payments.";
    const item = advice(check(resume({ summary }), "US"), "age.experienceYears");
    expect(item).toMatchObject({ kind: "age" });
    expect(item!.evidence).toContain('"30+ years of experience"');
  });

  it("reads the wordings resumes use", () => {
    for (const summary of [
      "Over 25 years’ experience in retail banking.",
      "Architect with 28 yrs of software experience.",
      "22 years of hands-on engineering experience",
    ])
      expect(
        advice(check(resume({ summary }), "US"), "age.experienceYears"),
        summary,
      ).toBeDefined();
  });

  it("advises on a work history dated across more than 20 years", () => {
    const item = advice(check(resume({ start: "Mar 2001" }), "US"), "age.experienceYears");
    expect(item?.evidence).toMatch(/^25 years of work history are dated\.$/);
  });

  it("is quiet at 20 years or fewer, and outside the regions that ask for it", () => {
    const summary = "Engineer with 12 years of experience.";
    expect(advice(check(resume({ summary }), "US"), "age.experienceYears")).toBeUndefined();
    expect(
      advice(check(resume({ start: "Jan 2010" }), "US"), "age.experienceYears"),
    ).toBeUndefined();
    expect(check(resume({ summary: "30+ years of experience" }), "DE").advice).toEqual([]);
  });

  it("reads hostile text in linear time", () => {
    const hostile = `${"9 years of ".repeat(2_000)}\n${"1 years ".repeat(1_500)}${"a ".repeat(3_000)}`;
    expectFast(() => check(`${resume()}\n${hostile}`, "US"), 2_000, "experience phrases");
  });
});
