import { describe, expect, it } from "vitest";

import { AtsPolicyError, DEFAULT_POLICY, parseAtsPolicy, parseResume } from "../../src/index.js";
import { ISCED_LABELS } from "../../src/format/index.js";

const NOW = new Date("2026-10-01T00:00:00Z");
const education = (body: string, policy = DEFAULT_POLICY) =>
  parseResume(`Jane Doe\nEDUCATION\n${body}`.split("\n"), policy, NOW);

describe("education levels on ISCED 2011", () => {
  it.each([
    ["High School Diploma, Lincoln High School 2012", 3],
    ["Diploma in Nursing, City College 2014", 4],
    ["Associate of Arts, Valley Community College 2015", 5],
    ["B.Tech, Computer Science, Delhi University 2016", 6],
    ["MBA, Harvard University 2020", 7],
    ["Ph.D. Physics, Stanford University 2024", 8],
  ])("reads %j at level %i", (line, isced) => {
    expect(education(line).education[0]).toMatchObject({ isced });
  });

  it("reports the highest level", () => {
    const parsed = education(
      "B.S. Mathematics, State University 2014\nM.S. Statistics, State University 2016",
    );
    expect(parsed.highestIsced).toBe(7);
    expect(ISCED_LABELS[parsed.highestIsced!]).toBe("Master's or equivalent");
  });

  it("refuses a policy that names no level", () => {
    const parse = () =>
      parseAtsPolicy({
        ...structuredClone(DEFAULT_POLICY),
        resumeParse: { ...structuredClone(DEFAULT_POLICY.resumeParse), degrees: {} },
      });
    expect(parse).toThrow(AtsPolicyError);
    try {
      parse();
    } catch (error) {
      expect(JSON.stringify((error as AtsPolicyError).issues)).toContain("at least one level");
    }
  });
});
