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
