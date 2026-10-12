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
    "Senior Software Engineer, Northwind Payments (Remote)",
    "Senior Software Engineer | Northwind Payments (San Francisco, CA)",
    "Senior Software Engineer at Northwind Payments (Hybrid)",
  ])("reads the title and the employer of %j", (header) => {
    expect(roleOf(header)).toMatchObject({
      title: "Senior Software Engineer",
      employer: "Northwind Payments",
      current: true,
    });
  });

  it("keeps a city that is not told from part of the employer", () => {
    expect(roleOf("Software Engineer, Acme, Berlin")?.employer).toBe("Acme, Berlin");
    expect(roleOf("Software Engineer, Acme (Europe)")?.employer).toBe("Acme (Europe)");
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
    [["Senior Engineer\tJan 2020 - Present", "Austin, TX"]],
    [["Senior Engineer, Remote\tJan 2020 - Present"]],
  ])("is not taken for the employer when none is named, in %j", (block) => {
    expect(rolesIn(...block)).toEqual([{ title: "Senior Engineer", employer: "" }]);
  });

  // "Austin, TX" over the dates, or after the title's comma, has the shape of "Google, CA": with
  // no employer named elsewhere, its first part is the employer, as "Infosys, India"'s is.
  it.each([
    [["Senior Engineer", "Austin, TX", "Jan 2020 - Present"], "Austin"],
    [["Senior Engineer, Austin, TX\tJan 2020 - Present"], "Austin"],
    [["Acme Corp", "Senior Engineer, Austin, TX\tJan 2020 - Present"], "Acme Corp"],
    [["Acme Corp", "Senior Engineer", "Austin, TX", "Jan 2020 - Present"], "Acme Corp"],
  ])("is not told from an employer with its state's code in %j", (block, employer) => {
    expect(rolesIn(...block)).toEqual([{ title: "Senior Engineer", employer }]);
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

describe("an employer with its state's code", () => {
  it.each([
    [["Analyst at Deloitte, NY\tJan 2020 - Present"], "Analyst", "Deloitte"],
    [["Nurse at Kaiser, CA\tJan 2020 - Present"], "Nurse", "Kaiser"],
    [["Engineer | Intel | OR\tJan 2020 - Present"], "Engineer", "Intel"],
    [["Software Engineer, Google, CA\tJan 2020 - Present"], "Software Engineer", "Google"],
    [["Data Analyst, Capital One, VA\tJan 2020 - Present"], "Data Analyst", "Capital One"],
    [["Software Engineer", "Google, CA", "Jan 2020 - Present"], "Software Engineer", "Google"],
  ])("keeps the title and the employer of %j", (block, title, employer) => {
    expect(rolesIn(...block)).toEqual([{ title, employer }]);
  });
});

describe("a city with its state or country named in full", () => {
  it.each([
    [["Software Engineer, Acme Corp, Berlin, Germany\tJan 2020 - Present"]],
    [["Software Engineer | Acme Corp | Bengaluru, Karnataka, India\tJan 2020 - Present"]],
    [["Software Engineer, Acme Corp, Toronto, ON, Canada\tJan 2020 - Present"]],
    [["Software Engineer | Acme Corp | India\tJan 2020 - Present"]],
    [["Software Engineer | Acme Corp", "Jan 2020 - Present | Austin, Texas, United States"]],
    [["Software Engineer | Acme Corp", "Jan 2020 - Present | Remote, India"]],
    [["Software Engineer", "Acme Corp", "Berlin, Germany", "Jan 2020 - Present"]],
    [["Acme Corp", "Software Engineer", "Austin, Texas, United States", "Jan 2020 - Present"]],
    // A first part ending in a legal form is the employer, not a city: it was dropped as one.
    [["Software Engineer", "Acme Corp, TX", "Jan 2020 - Present"]],
  ])("is neither the title nor the employer in %j", (block) => {
    expect(rolesIn(...block)).toEqual([{ title: "Software Engineer", employer: "Acme Corp" }]);
  });

  it.each([
    ["Software Engineer, Georgia Pacific", "Georgia Pacific"],
    ["Reporter, Washington Post, Washington, DC", "Washington Post"],
    ["Analyst, Bank of America, Charlotte, North Carolina", "Bank of America"],
    // No country or state after it: the city is not told from part of the employer.
    ["Software Engineer, Acme, Berlin", "Acme, Berlin"],
  ])("keeps a name that holds a place's in %j", (header, employer) => {
    expect(rolesIn(`${header}\tJan 2020 - Present`)[0]?.employer).toBe(employer);
  });

  it("is not a place when its first part is a job title", () => {
    expect(rolesIn("Software Engineer, India\tJan 2020 - Present")[0]?.title).toBe(
      "Software Engineer",
    );
  });

  // An employer with its country or state on a line of its own has the shape of a city with
  // its country: with no employer named elsewhere, it is the employer.
  it.each([
    [["Software Engineer", "Infosys, India", "Jan 2020 - Present"], "Infosys"],
    [["Software Engineer", "Google, India", "Jan 2020 - Present"], "Google"],
    [["Software Engineer", "Microsoft, Washington", "Jan 2020 - Present"], "Microsoft"],
    [["Software Engineer", "Dell, Texas", "Jan 2020 - Present"], "Dell"],
    [["Software Engineer", "Deloitte, USA", "Jan 2020 - Present"], "Deloitte"],
    [["Software Engineer", "Accenture, UK", "Jan 2020 - Present"], "Accenture"],
    [["Software Engineer", "Bank of America, Texas", "Jan 2020 - Present"], "Bank of America"],
    [["Infosys, India", "Software Engineer", "Jan 2020 - Present"], "Infosys"],
    [["Software Engineer | Jan 2020 - Present", "Infosys, India"], "Infosys"],
    [["Software Engineer\tJan 2020 - Present", "Infosys, India"], "Infosys"],
    // A country or state's name alone, as an employer's.
    [["Software Engineer", "Jordan", "Jan 2020 - Present"], "Jordan"],
    [["Software Engineer", "Victoria", "Jan 2020 - Present"], "Victoria"],
    [["Software Engineer", "Washington", "Jan 2020 - Present"], "Washington"],
  ])("keeps the employer of %j", (block, employer) => {
    expect(rolesIn(...block)).toEqual([{ title: "Software Engineer", employer }]);
  });

  it("keeps a school with its state", () => {
    expect(
      rolesIn("Teaching Assistant", "University of Georgia, Georgia", "Jan 2020 - Present"),
    ).toEqual([{ title: "Teaching Assistant", employer: "University of Georgia" }]);
  });

  it("keeps an employer with its country over the roles under it", () => {
    expect(
      rolesIn(
        "Infosys, India",
        "Software Engineer",
        "Mar 2021 - Present",
        "- Built a billing service handling 2M requests a day",
        "Associate Engineer",
        "Jan 2018 - Feb 2021",
      ),
    ).toEqual([
      { title: "Software Engineer", employer: "Infosys" },
      { title: "Associate Engineer", employer: "Infosys" },
    ]);
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

  it.each([
    [["Software Engineer, Acme Corp", "2 years", "Jan 2020 - Dec 2021"]],
    [["Software Engineer | Acme Corp", "(2 years)", "Jan 2020 - Dec 2021"]],
    [["Acme Corp", "Software Engineer", "2 yrs 3 mos", "Jan 2020 - Dec 2021"]],
    [["Software Engineer", "Acme Corp", "2 years", "Jan 2020 - Dec 2021"]],
  ])("between the header and its dates leaves the header in %j", (block) => {
    expect(rolesIn(...block)).toEqual([{ title: "Software Engineer", employer: "Acme Corp" }]);
  });
});

describe("a comma inside the title", () => {
  it.each([
    [
      "Director, Product Management | Acme Corp | Jan 2020 - Present",
      "Director, Product Management",
      "Acme Corp",
    ],
    [
      "Director, Product Management | Acme Corp | Austin, TX",
      "Director, Product Management",
      "Acme Corp",
    ],
    [
      "Director, Product Management — Northwind Bank",
      "Director, Product Management",
      "Northwind Bank",
    ],
    [
      "Teaching Assistant, Physics | Ohio State University",
      "Teaching Assistant, Physics",
      "Ohio State University",
    ],
    ["VP, Engineering, Acme, Inc.", "VP, Engineering", "Acme, Inc"],
    ["VP, Engineering, Acme Corp", "VP, Engineering", "Acme Corp"],
    [
      "Senior Engineer, Platform Team, Northwind Inc., Austin, TX",
      "Senior Engineer, Platform Team",
      "Northwind Inc",
    ],
    ["Senior Engineer, Platform, Acme Corp", "Senior Engineer, Platform", "Acme Corp"],
    // A department after the comma (`departmentWords`) is the title's, whatever the employer.
    [
      "Director, Product Management | Google | Jan 2020 - Present",
      "Director, Product Management",
      "Google",
    ],
    ["Director, Product Management — Google", "Director, Product Management", "Google"],
    [
      "Manager, Research & Development | Northwind | Austin, TX",
      "Manager, Research & Development",
      "Northwind",
    ],
  ])("keeps the title of %j whole", (header, title, employer) => {
    expect(roleOf(header)).toMatchObject({ title, employer });
  });

  it.each([
    // A comma part beside a place, or a city and its country, is still the employer.
    ["Senior Engineer, Acme — Austin, TX", "Senior Engineer", "Acme"],
    ["Senior Engineer, Acme | Remote", "Senior Engineer", "Acme"],
    // The city goes with its country (`placeNames`): it was kept as part of the employer.
    ["Software Engineer, Acme | Berlin, Germany", "Software Engineer", "Acme"],
    // Without a company's legal form after it, a third part is where.
    ["Software Engineer, Acme, Berlin", "Software Engineer", "Acme, Berlin"],
    // A description of the employer is not an employer of its own, nor a street named for one.
    [
      "Software Engineer, Waymo, an Alphabet company",
      "Software Engineer",
      "Waymo, an Alphabet company",
    ],
    ["Software Engineer, Acme, Bank Street, NY", "Software Engineer", "Acme"],
    // No department after the comma: the employer, then where.
    ["Software Engineer, Acme | Berlin", "Software Engineer", "Acme, Berlin"],
    // A company named in words a department may be named in, before its city.
    ["Manager, Security Finance | Spartanburg", "Manager", "Security Finance, Spartanburg"],
  ])("still reads the employer after the comma in %j", (header, title, employer) => {
    expect(roleOf(header)).toMatchObject({ title, employer });
  });
});

describe("an employer written before the title", () => {
  it.each([
    ["Deloitte, Accountant", "Accountant", "Deloitte"],
    ["Mercy Hospital, Registered Nurse", "Registered Nurse", "Mercy Hospital"],
    ["Lincoln High School, Teacher", "Teacher", "Lincoln High School"],
    ["Acme Corp, CTO", "CTO", "Acme Corp"],
    ["Target - Cashier", "Cashier", "Target"],
    ["Account Executive, Head & Shoulders Media", "Account Executive", "Head & Shoulders Media"],
    ["Northwind Bank | Teller", "Teller", "Northwind Bank"],
    // No title word on either side: the side naming an organisation is the employer.
    ["Globex Corporation, Croupier", "Croupier", "Globex Corporation"],
    ["Globex Corporation, Croupier, Austin, TX", "Croupier", "Globex Corporation"],
  ])("reads %j as the title at the employer", (header, title, employer) => {
    expect(roleOf(header)).toMatchObject({ title, employer });
  });

  it("still reads the first part as the title when neither side names an organisation", () => {
    expect(roleOf("Croupier, Globex")).toMatchObject({ title: "Croupier", employer: "Globex" });
  });

  it.each([
    ["Acme Corp, Berlin\tJan 2020 - Present", "Acme Corp, Berlin"],
    ["Siemens AG, Munich\tJan 2020 - Present", "Siemens AG, Munich"],
    ["Acme, Berlin\tJan 2020 - Present", "Acme, Berlin"],
  ])("reads %j over a title alone as the employer and its city", (dated, employer) => {
    expect(rolesIn(dated, "Software Engineer")).toEqual([{ title: "Software Engineer", employer }]);
  });

  it("still reads an organisation and a title with no title word beside the dates", () => {
    expect(rolesIn("Globex Corporation, Croupier\tJan 2020 - Present")).toEqual([
      { title: "Croupier", employer: "Globex Corporation" },
    ]);
  });

  it("reads a title word before an organisation's name", () => {
    expect(roleOf("Bank Manager, Globex")).toMatchObject({
      title: "Bank Manager",
      employer: "Globex",
    });
  });
});
