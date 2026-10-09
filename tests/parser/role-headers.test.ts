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
