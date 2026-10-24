import { describe, expect, it } from "vitest";

import { DEFAULT_POLICY, parseResume } from "../../src/index.js";

const now = new Date("2026-10-01T00:00:00Z");
const endOf = (line: string) =>
  parseResume(["Jane Doe", "jane.doe@example.com", "Education", line], DEFAULT_POLICY, now)
    .education[0]?.end;

describe("an expected graduation written with a two-digit end year", () => {
  it.each([
    "B.Tech Computer Science, IIT Delhi, 2023–27",
    "B.Tech Computer Science, IIT Delhi, 2023-27",
    "B.Tech Computer Science, IIT Delhi, 2023 - 27",
  ])("reads the end year of %j", (line) => {
    expect(endOf(line)).toEqual({ year: 2027, month: null });
  });

  it("still reads a past one", () => {
    expect(endOf("B.S. Computer Science, State University, 2015–19")).toEqual({
      year: 2019,
      month: null,
    });
  });

  it("keeps a role's short end year from running past today", () => {
    const roles = parseResume(
      ["Jane Doe", "Experience", "Engineer, Acme", "2023–27", "- Built things."],
      DEFAULT_POLICY,
      now,
    ).roles;
    expect(roles[0]?.end?.year ?? null).not.toBe(2027);
  });
});

describe("an education entry's dates on a line of their own", () => {
  const endsOf = (...lines: string[]) =>
    parseResume(
      ["Jane Doe", "jane.doe@example.com", "Education", ...lines],
      DEFAULT_POLICY,
      now,
    ).education.map((entry) => entry.end?.year ?? null);

  it("end the entry above, on one line or two", () => {
    expect(endsOf("BSc Computer Science", "University of Leeds", "2015 – 2019")).toEqual([2019]);
    expect(endsOf("BSc Computer Science, University of Leeds", "2015 – 2019")).toEqual([2019]);
    expect(endsOf("University of Leeds", "BSc Computer Science", "2019")).toEqual([2019]);
  });

  it("do not end the entry above when they head each entry", () => {
    expect(
      endsOf(
        "2015 – 2019",
        "BSc Computer Science, University of Leeds",
        "2019 – 2021",
        "MSc Data Science, University College London",
      ),
    ).toEqual([null, null]);
  });
});
