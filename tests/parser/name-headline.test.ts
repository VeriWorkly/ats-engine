import { describe, expect, it } from "vitest";

import { AtsScoringService, DEFAULT_POLICY } from "../../src/index.js";

const name = (text: string) => AtsScoringService.check(text, DEFAULT_POLICY).parsed.name;

describe("the name when a sidebar is read first", () => {
  const sidebar = [
    "CONTACT",
    "+1 415 555 0162",
    "lucas@moreau.design",
    "San Francisco, CA",
    "SKILLS",
    "Figma",
    "Sketch",
    "LUCAS MOREAU",
    "SENIOR PRODUCT DESIGNER",
    "PROFILE",
    "Product designer with 8 years of experience shaping mobile and web products.",
    "EXPERIENCE",
    "Lead Product Designer, Northwind Travel",
    "Jan 2020 - Present",
  ].join("\n");

  it("takes the name above the headline, not a city whose state was read as a credential", () => {
    expect(name(sidebar)).toBe("LUCAS MOREAU");
  });

  it("still reads a credential after the name at the top", () => {
    expect(
      name(
        "Jane Doe, MD\njane@example.com\n\nExperience\nPhysician, General Hospital\n2015 - Present",
      ),
    ).toBe("Jane Doe");
  });

  it("never takes an employer from the work history for the name", () => {
    // The name is in an image, so no line at the top holds it.
    const text = [
      "EXPERIENCE",
      "Acme Corporation",
      "Senior Engineer",
      "Jan 2020 - Present",
      "- Built payment systems in TypeScript.",
    ].join("\n");
    expect(name(text)).toBe("");
  });

  /** A LinkedIn "Save to PDF" profile: Contact and Top Skills read before the name. */
  const linkedIn = (skills: string[]) =>
    [
      "Contact",
      "jordan.ellery@example.com",
      "www.linkedin.com/in/jordanellery",
      "Top Skills",
      ...skills,
      "Jordan Ellery",
      "Senior Software Engineer at Acme Corp",
      "Austin, Texas, United States",
      "Summary",
      "Backend engineer with nine years building payment systems.",
      "Experience",
      "Senior Software Engineer, Acme Corp",
      "January 2022 - Present",
    ].join("\n");

  it("reads a LinkedIn export's name, and its top skills without it", () => {
    const { parsed } = AtsScoringService.check(
      linkedIn(["Kubernetes", "TypeScript", "PostgreSQL"]),
      DEFAULT_POLICY,
    );
    expect(parsed.name).toBe("Jordan Ellery");
    expect(parsed.skills).toEqual(["Kubernetes", "TypeScript", "PostgreSQL"]);
  });

  it("does not take a two-word skill in the sidebar for the name", () => {
    expect(name(linkedIn(["Machine Learning"]))).toBe("Jordan Ellery");
  });

  it.each([
    "Senior Software Engineer at Acme Corp | Building payment systems for small businesses",
    "Staff Engineer - Payments, Ledgers and Fraud Systems at Acme Corp",
  ])("reads the name over a long headline whose title comes first: %j", (headline) => {
    const text = linkedIn(["Machine Learning"]).replace(
      "Senior Software Engineer at Acme Corp",
      headline,
    );
    expect(name(text)).toBe("Jordan Ellery");
  });

  it.each([
    "Helping fintechs ship faster | Payments | Distributed Systems",
    "Building calm, reliable payment systems for small businesses everywhere",
  ])("reads the name over a headline with no title, above where the person is: %j", (headline) => {
    const text = linkedIn(["Machine Learning", "Kubernetes"]).replace(
      "Senior Software Engineer at Acme Corp",
      headline,
    );
    const { parsed } = AtsScoringService.check(text, DEFAULT_POLICY);
    expect(parsed.name).toBe("Jordan Ellery");
    expect(parsed.skills).toEqual(["Machine Learning", "Kubernetes"]);
  });

  it.each([
    // The name before the profile's address: no export's sidebar is between them.
    [
      [
        "Skills",
        "Python",
        "Go",
        "Jane Doe",
        "linkedin.com/in/someone",
        "Education",
        "Rice University",
        "BS Computer Science",
        "Houston, Texas",
      ],
      "Jane Doe",
    ],
    // No name at all: a school over its degree and city is no name.
    [
      [
        "jane@example.com",
        "linkedin.com/in/someone",
        "Skills",
        "Python",
        "Go",
        "Education",
        "Rice University",
        "BS Computer Science",
        "Houston, Texas",
      ],
      "",
    ],
  ])("reads no school as a LinkedIn export's name in %j", (top, expected) => {
    const text = [...top, "Experience", "Software Engineer, Acme", "Mar 2021 – Present"];
    expect(name(text.join("\n"))).toBe(expected);
  });

  it("never reads a school over a headline as a LinkedIn export's name", () => {
    const text = linkedIn(["Machine Learning"])
      .replace("Jordan Ellery", "Rice University")
      .replace("Senior Software Engineer at Acme Corp", "Helping fintechs ship faster");
    expect(name(text)).not.toBe("Rice University");
  });

  it("keeps a skills list that opens the page when no name is found", () => {
    const text = [
      "Skills",
      "Machine Learning",
      "Data Science",
      "Python",
      "Experience",
      "Data Scientist, Acme Corp",
      "Jan 2020 - Present",
      "- Built churn models",
    ].join("\n");
    expect(AtsScoringService.check(text, DEFAULT_POLICY).parsed.skills).toEqual([
      "Machine Learning",
      "Data Science",
      "Python",
    ]);
  });

  /** A list heading first, the name over its email, then `rest`, then the work history. */
  const listFirst = (list: string, rest: string) =>
    `${list}\nJane Doe\njane@example.com\n${rest}\nEXPERIENCE\nSoftware Engineer, Acme Corp    2019 – 2022\n• Built things`;

  it.each([
    ["SKILLS\nPython, SQL", "REFERENCES\nJohn Smith\nEngineering Manager, Acme"],
    ["SKILLS\nPython, SQL", "VOLUNTEERING\nRed Cross\nVolunteer Coordinator"],
    ["SKILLS\nPython", "PROJECTS\nRide Share\nLead Developer"],
    ["SKILLS\nPython, SQL", "EDUCATION\nBoston College\nTeaching Fellow"],
    ["SKILLS\nPython", "CERTIFICATIONS\nAWS Certified\nSolutions Architect"],
    ["LANGUAGES\nEnglish", "SUMMARY\nData scientist.\nPROJECTS\nCredit Risk Model\nLead Analyst"],
  ])("reads the name over its email under %j, not a name over a title under %j", (list, rest) => {
    const { parsed } = AtsScoringService.check(listFirst(list, rest), DEFAULT_POLICY);
    expect(parsed.name).toBe("Jane Doe");
    expect(parsed.skills).not.toContain("Jane Doe");
  });

  it("keeps the certifications under the name's list heading", () => {
    const { parsed } = AtsScoringService.check(
      listFirst("SKILLS\nPython", "CERTIFICATIONS\nAWS Certified\nSolutions Architect"),
      DEFAULT_POLICY,
    );
    expect(parsed.certifications.map((cert) => cert.name)).toEqual([
      "AWS Certified",
      "Solutions Architect",
    ]);
  });

  it("does not cut a list at its first row read as the name", () => {
    const text =
      "SKILLS\nPython\nKubernetes\nCERTIFICATIONS\nGoogle Cloud\nProfessional Cloud Architect\nJane Doe\njane@example.com\nEXPERIENCE\nSoftware Engineer, Acme Corp    2019 – 2022\n• Built things";
    const { parsed } = AtsScoringService.check(text, DEFAULT_POLICY);
    expect(parsed.certifications.map((cert) => cert.name)).toEqual(
      expect.arrayContaining(["Google Cloud", "Professional Cloud Architect"]),
    );
  });
});

describe("a role row whose title and dates both wrap", () => {
  it("rejoins each side with its own continuation", () => {
    const text = [
      "Margaret Ellis",
      "margaret@example.com",
      "",
      "Experience",
      "Director of Engineering, Trey Research\tJun 2008 – Feb 2013",
      "- Led 60 engineers across three products.",
      "Senior Software Engineer, then Engineering Manager, Alpine Ski House\tJul 2003 – May",
      "Systems\t2008",
      "- Built the booking platform used by 40 resorts.",
    ].join("\n");
    const { roles } = AtsScoringService.check(text, DEFAULT_POLICY, {
      now: new Date("2024-01-01"),
    }).parsed;
    expect(roles).toHaveLength(2);
    expect(roles[1]).toMatchObject({
      start: { year: 2003, month: 7 },
      end: { year: 2008, month: 5 },
    });
    expect(`${roles[1]!.title} ${roles[1]!.employer}`).toContain("Alpine Ski House Systems");
  });
});

describe("a letter-spaced name whose word gap was lost", () => {
  const sidebarFirst = (nameLine: string, email: string) =>
    [
      "CONTACT",
      email,
      "+1 415 555 0100",
      "San Francisco, CA",
      "SKILLS",
      "Python",
      nameLine,
      "Senior Backend Engineer",
      "EXPERIENCE",
      "Backend Engineer, Acme Corp",
      "Jan 2020 - Present",
    ].join("\n");

  it("is split where the email splits the same letters", () => {
    expect(name(sidebarFirst("J A N E D O E", "jane.doe@example.com"))).toBe("JANE DOE");
  });

  it("is left alone when the email does not spell it", () => {
    expect(name(sidebarFirst("J A N E D O E", "jd1987@example.com"))).not.toBe("JANE DOE");
  });
});

describe("a name that is also a place", () => {
  it.each([
    "Jordan Ellery",
    "Georgia Lane",
    "Victoria Chen",
    "Chad Morgan",
    "Israel Ortiz",
    "Carolina Ruiz",
  ])("is still the name over a city, state and country: %j", (person) => {
    expect(
      name(
        `${person}\nAustin, Texas, United States | person@example.com\nExperience\nSoftware Engineer, Georgia Pacific\nJan 2020 - Present`,
      ),
    ).toBe(person);
  });
});

describe("a surname that is also a job title", () => {
  it.each([
    "Alex Teller",
    "ALEX NURSE",
    "Sam Clerk",
    "Jordan Writer",
    "Sam Tutor",
    "Morgan Lawyer",
    "Morgan Mechanic",
    "Maria Teller-Smith",
    "Morgan Teacher",
  ])("is still the name: %j", (person) => {
    expect(
      name(
        `${person}\nalex@example.com | (555) 123-4567\nExperience\nSoftware Engineer, Acme Corp\nJan 2020 - Present`,
      ),
    ).toBe(person);
  });
});
