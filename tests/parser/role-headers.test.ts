import { describe, expect, it } from "vitest";

import { DEFAULT_POLICY, parseResume } from "../../src/index.js";

/** Role headers with their location, in the forms resume templates print them. */

const now = new Date("2026-10-01T00:00:00Z");

const roleOf = (header: string) =>
  parseResume(
    [
      "Jane Doe",
      "jane.doe@example.com",
      "Experience",
      header,
      "Mar 2021 – Present",
      "- Built the ledger.",
    ],
    DEFAULT_POLICY,
    now,
  ).roles[0];

describe("a role header with its location", () => {
  it.each([
    "Senior Software Engineer, Northwind Payments — San Francisco, CA",
    "Senior Software Engineer | Northwind Payments | San Francisco, CA",
    "Senior Software Engineer at Northwind Payments, San Francisco, CA",
    "Senior Software Engineer, Northwind Payments, San Francisco, CA",
    "Senior Software Engineer, Northwind Payments, Remote",
    "Northwind Payments — Senior Software Engineer",
  ])("reads the title and the employer of %j", (header) => {
    expect(roleOf(header)).toMatchObject({
      title: "Senior Software Engineer",
      employer: "Northwind Payments",
      current: true,
    });
  });

  it("keeps a city that is not told from part of the employer", () => {
    expect(roleOf("Software Engineer, Acme, Berlin")?.employer).toBe("Acme, Berlin");
  });

  it("does not take a description line for a header", () => {
    const roles = parseResume(
      [
        "Jane Doe",
        "Experience",
        "Software Engineer, Acme Corporation",
        "Jan 2019 – Dec 2020",
        "Led the payments team, the ledger service and the on-call rota",
        "Mar 2021 – Present",
        "Senior Engineer, Northwind Payments",
      ],
      DEFAULT_POLICY,
      now,
    ).roles;
    expect(roles.map((role) => role.employer)).not.toContain("the ledger service");
  });
});

/** The roles a resume reads, with a bullet under the block and an education section after it. */
const rolesIn = (...block: string[]) =>
  parseResume(
    [
      "Jordan Ellery",
      "jordan.ellery@example.com | (415) 555-0132",
      "Experience",
      ...block,
      "- Built a billing service handling 2M requests a day",
      "Education",
      "B.S. Computer Science, Ohio State University, 2014",
    ],
    DEFAULT_POLICY,
    now,
  ).roles.map(({ title, employer }) => ({ title, employer }));

describe("a city and state beside the dates", () => {
  it.each([
    [["Senior Engineer | Acme Corp", "Jan 2020 - Present | Austin, TX"]],
    [["Senior Engineer, Acme Corp", "Jan 2020 - Present\tAustin, TX"]],
    [["Acme Corp", "Senior Engineer", "Austin, TX | Jan 2020 - Present"]],
    [["Senior Engineer", "Acme Corp", "Jan 2020 - Present | Austin, TX"]],
    [["Acme Corp | Austin, TX | Jan 2020 - Present", "Senior Engineer"]],
    [["Senior Engineer\tJan 2020 - Present | Remote", "Acme Corp"]],
    [["Acme Corp\tAustin, TX", "Senior Engineer\tJan 2020 - Present"]],
    [["Acme Corp\tJan 2020 - Present", "Senior Engineer\tAustin, TX"]],
    [["Acme Corp    Austin, TX", "Senior Engineer    Jan 2020 - Present"]],
    [["Senior Engineer", "Acme Corp", "Austin, TX", "Jan 2020 - Present"]],
  ])("is neither the title nor the employer in %j", (block) => {
    expect(rolesIn(...block)).toEqual([{ title: "Senior Engineer", employer: "Acme Corp" }]);
  });

  it.each([
    [["Senior Engineer", "Austin, TX", "Jan 2020 - Present"]],
    [["Senior Engineer\tJan 2020 - Present", "Austin, TX"]],
    [["Senior Engineer, Austin, TX\tJan 2020 - Present"]],
    [["Senior Engineer, Remote\tJan 2020 - Present"]],
  ])("is not taken for the employer when none is named, in %j", (block) => {
    expect(rolesIn(...block)).toEqual([{ title: "Senior Engineer", employer: "" }]);
  });

  it.each([
    ["Senior Engineer, Acme Corp, Austin, TX", "Acme Corp"],
    ["Senior Engineer, Acme Corp, Toronto, ON", "Acme Corp"],
    ["Senior Engineer, Acme Corp, Salt Lake City, UT", "Acme Corp"],
    ["Senior Engineer, Acme Corp, New York City, NY", "Acme Corp"],
    ["Senior Engineer, Bank of America — Charlotte, NC", "Bank of America"],
    ["Senior Engineer, Johnson & Johnson", "Johnson & Johnson"],
    ["Senior Engineer | Acme Corp | Austin, TX | Jan 2020 - Present", "Acme Corp"],
    // Two columns run together: the employer is not told from its city, so both are kept.
    ["Marketing Manager, Oakmont Foods Portland, OR", "Oakmont Foods Portland, OR"],
  ])("still leaves the employer of %j", (header, employer) => {
    const line = header.includes("2020") ? header : `${header}\tJan 2020 - Present`;
    expect(rolesIn(line)[0]?.employer).toBe(employer);
  });
});

describe("an employer whose name holds an employer word", () => {
  it.each([
    [
      "Teaching Assistant, The University of Texas at Austin",
      "Teaching Assistant",
      "The University of Texas at Austin",
    ],
    [
      "Research Assistant, University of Michigan at Ann Arbor",
      "Research Assistant",
      "University of Michigan at Ann Arbor",
    ],
  ])("keeps %j whole", (header, title, employer) => {
    expect(roleOf(header)).toMatchObject({ title, employer });
  });

  it("still splits a title from its employer at the word", () => {
    expect(roleOf("Research Assistant at University of Michigan")).toMatchObject({
      title: "Research Assistant",
      employer: "University of Michigan",
    });
    expect(roleOf("Senior Engineer at Acme Corporation")).toMatchObject({
      title: "Senior Engineer",
      employer: "Acme Corporation",
    });
  });
});

describe("the time at an employer on a line of its own", () => {
  it("is neither the title nor the employer of the roles under the employer", () => {
    expect(
      rolesIn(
        "Acme Corp",
        "4 years 9 months",
        "Senior Software Engineer",
        "January 2022 - Present (4 years 9 months)",
        "Austin, Texas, United States",
        "- Built a billing service handling 2M requests a day",
        "Software Engineer",
        "September 2019 - December 2021 (2 years 4 months)",
      ),
    ).toEqual([
      { title: "Senior Software Engineer", employer: "Acme Corp" },
      { title: "Software Engineer", employer: "Acme Corp" },
    ]);
  });
});
