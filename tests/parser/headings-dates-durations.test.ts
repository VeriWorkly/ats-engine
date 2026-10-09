import { describe, expect, it } from "vitest";

import { AtsScoringService, DEFAULT_POLICY, parseResume } from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import { statesDateOfBirth } from "../../src/parser/contact.js";
import { segmentResume } from "../../src/parser/sections.js";
import { expectFast } from "../fixtures/timing.js";

/**
 * Parser defects from the October audit, one block each. Every resume here is invented.
 */

const NOW = new Date(Date.UTC(2026, 7, 31));

const parse = (text: string, policy = DEFAULT_POLICY) =>
  parseResume(
    text
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    policy,
    NOW,
  );

const rows = (text: string) =>
  parse(text).roles.map(({ title, employer, start, end, current }) => ({
    title,
    employer,
    start,
    end,
    current,
  }));

const LOCALIZED = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
const check = (text: string, options: { region?: string; languages?: string[] } = {}) =>
  AtsScoringService.check(text, LOCALIZED, { now: NOW, ...options }).parsed;

describe("experience and skills headings beyond software's", () => {
  it("reads a fresher's internships after Education, not as education", () => {
    const parsed = parse(
      [
        "Priya Sharma",
        "Education",
        "B.Tech Computer Science, IIT Delhi, 2020 - 2024",
        "Internship",
        "Software Intern, Infosys",
        "May 2023 - Jul 2023",
        "Key Skills",
        "Java, Python",
      ].join("\n"),
    );
    expect(parsed.roles).toMatchObject([{ title: "Software Intern", employer: "Infosys" }]);
    expect(parsed.skills).toEqual(["Java", "Python"]);
  });

  it.each([
    "Clinical Experience",
    "Internships",
    "Internship Experience",
    "Leadership Experience",
    "Research Experience",
    "Teaching Experience",
    "Academic Appointments",
    "Career History",
    "Professional Background",
  ])("opens the work history at %j", (heading) => {
    const sections = segmentResume(
      ["Jane Doe", "Education", "BS Biology, State University, 2018", heading, "x"],
      DEFAULT_POLICY,
    );
    expect(sections.at(-1)).toMatchObject({ kind: "experience", lines: ["x"] });
  });

  it.each(["Key Skills", "Core Competencies", "Areas of Expertise"])(
    "opens the skills at %j",
    (heading) => {
      expect(parse(`Jane Doe\n${heading}\nTriage, Charting`).skills).toEqual([
        "Triage",
        "Charting",
      ]);
    },
  );

  it("closes Education at a heading it does not know, written like the ones it does", () => {
    const sections = segmentResume(
      [
        "JANE DOE",
        "EDUCATION",
        "BS Biology, State University, 2018",
        "VOLUNTEER WORK",
        "Tutor, Reading Partners, 2019 - 2020",
        "SKILLS",
        "Python",
      ],
      DEFAULT_POLICY,
    );
    expect(sections.map((section) => section.kind)).toEqual([
      "other",
      "education",
      "other",
      "skills",
    ]);
  });

  it("keeps a field of study on its own line inside Education", () => {
    const sections = segmentResume(
      [
        "Education",
        "Stanford University",
        "Computer Science",
        "Bachelor of Science, 2018",
        "Skills",
        "Go",
      ],
      DEFAULT_POLICY,
    );
    expect(sections[0]).toMatchObject({ kind: "education" });
    expect(sections[0].lines).toHaveLength(3);
  });
});

describe("a job title that starts with a heading word", () => {
  it("reads Education Officer and Skills Trainer as titles", () => {
    expect(
      rows(
        "Jane Doe\nExperience\nEducation Officer\nMinistry of Learning\nJan 2019 - Present\nSkills Trainer\nAcme Corp\n2016 - 2018",
      ),
    ).toMatchObject([
      { title: "Education Officer", employer: "Ministry of Learning", current: true },
      { title: "Skills Trainer", employer: "Acme Corp" },
    ]);
  });

  it("does not take the next role's title as an Experience Designer's employer", () => {
    expect(
      rows(
        "Jane Doe\nExperience\nExperience Designer\nAcme Corp\nJan 2019 - Present\nProduct Designer\nGlobex\n2016 - 2018",
      ),
    ).toMatchObject([
      { title: "Experience Designer", employer: "Acme Corp" },
      { title: "Product Designer", employer: "Globex" },
    ]);
  });

  it("still reads a heading over dates when nothing follows the heading word", () => {
    expect(rows("Jane Doe\nExperience\nJan 2019 - Present\nEngineer, Acme")).toMatchObject([
      { title: "Engineer", employer: "Acme" },
    ]);
  });
});

describe("a LinkedIn duration beside the dates", () => {
  it("is neither the title nor the employer", () => {
    expect(
      rows(
        [
          "Jane Doe",
          "Experience",
          "Senior Engineer",
          "Acme Corp",
          "Jan 2020 - Present · 4 yrs 9 mos",
          "Analyst, Initech",
          "January 2014 - December 2019 (5 years 11 months)",
        ].join("\n"),
      ),
    ).toMatchObject([
      { title: "Senior Engineer", employer: "Acme Corp", current: true },
      { title: "Analyst", employer: "Initech" },
    ]);
  });
});

describe("date spellings that dropped the role", () => {
  it.each([
    ["Engineer, Acme 2019–21", { year: 2019, month: null }, { year: 2021, month: null }],
    ["Engineer, Acme 1998 - 02", { year: 1998, month: null }, { year: 2002, month: null }],
    [
      "Tutor, Uni Labs Spring 2020 - Fall 2021",
      { year: 2020, month: 3 },
      { year: 2021, month: 11 },
    ],
    ["Analyst, Initech Jan '20 - Mar '22", { year: 2020, month: 1 }, { year: 2022, month: 3 }],
    ["Intern, Pied Piper Summer 2018", { year: 2018, month: 6 }, { year: 2018, month: 8 }],
    ["Lead, Umbrella Jan2020 - Mar2021", { year: 2020, month: 1 }, { year: 2021, month: 3 }],
  ])("reads %j", (line, start, end) => {
    const [role] = rows(`Jane Doe\nExperience\n${line}`);
    expect(role).toMatchObject({ start, end, current: false });
    expect(role.employer).not.toMatch(/\d|Jan/);
  });

  it("reads 2020 - Today as current", () => {
    expect(rows("Jane Doe\nExperience\nManager, Hooli 2020 - Today")).toMatchObject([
      { title: "Manager", employer: "Hooli", current: true },
    ]);
  });

  it("does not read an ISO month, or the digits of an ORCID iD, as a range", () => {
    expect(rows("Jane Doe\nExperience\nReleased 2021-03")).toEqual([]);
    expect(rows("Jane Doe\norcid.org/0000-0002-1825-0097")).toEqual([]);
  });
});

describe("the education fallback", () => {
  it("does not read bullets in the work history as degrees or schools", () => {
    const parsed = parse(
      [
        "Jane Doe",
        "Experience",
        "Manager, Acme 2019 - 2022",
        "- Ran a PhD intern program",
        "- Partnered with Stanford University on the BA team rollout",
      ].join("\n"),
    );
    expect(parsed.education).toEqual([]);
    expect(parsed.highestIsced).toBeNull();
  });
});

describe("two dated qualifications on adjacent lines", () => {
  it("are not merged into one", () => {
    const parsed = check(
      "Priya Sharma\n+91 98765 43210\nEducation\nB.Tech in CS, IIT Bombay, 2014 - 2018\nClass XII, CBSE, Delhi Public School, 2014",
      { region: "IN" },
    );
    expect(parsed.education).toMatchObject([
      { school: "", credential: "B.Tech", isced: 6 },
      { school: "Delhi Public School", credential: "Class XII", isced: 3 },
    ]);
  });

  it("still merges a degree over its undated school", () => {
    expect(
      parse("Jane Doe\nEducation\nB.S., Computer Science 2015 - 2019\nUniversity of Washington")
        .education,
    ).toMatchObject([{ school: "University of Washington", credential: "B.S.", isced: 6 }]);
  });
});

describe("several roles at one employer", () => {
  it("carry the employer line above them", () => {
    expect(
      rows(
        [
          "Jane Doe",
          "Experience",
          "Acme Corporation, New York, NY",
          "Senior Engineer",
          "Jan 2021 - Present",
          "Engineer",
          "Jan 2019 - Dec 2020",
          "Globex Inc",
          "Intern",
          "Jun 2018 - Aug 2018",
        ].join("\n"),
      ),
    ).toMatchObject([
      { title: "Senior Engineer", employer: "Acme Corporation" },
      { title: "Engineer", employer: "Acme Corporation" },
      { title: "Intern", employer: "Globex Inc" },
    ]);
  });

  it("do not lend an employer to a later role that names none", () => {
    expect(
      rows(
        "Jane Doe\nExperience\nSenior Engineer\nAcme Corp\n2021 - Present\n- Built things\nFreelance Consultant\n2019 - 2021",
      ),
    ).toMatchObject([
      { title: "Senior Engineer", employer: "Acme Corp" },
      { title: "Freelance Consultant", employer: "" },
    ]);
  });
});

describe("the name on a designed resume", () => {
  it("is never a section heading such as CONTACT", () => {
    expect(parse("CONTACT\njane@example.com\nJane Doe\nExperience").name).toBe("Jane Doe");
  });

  it("keeps the word gap a PDF prints as a tab in a letter-spaced name", () => {
    expect(parse("L U C A S\tM O R E A U\nlucas@example.com").name).toBe("LUCAS MOREAU");
  });
});

describe("a name sharing its line", () => {
  it("is read from a combined contact line", () => {
    expect(parse("Jane Doe | jane@example.com | 415-555-0142\nExperience").name).toBe("Jane Doe");
  });

  it("is read after a Name label", () => {
    expect(parse("Name: Jane Doe\nEmail: jane@example.com").name).toBe("Jane Doe");
  });

  it("is not an address further down", () => {
    expect(parse("Senior Software Engineer\nSan Francisco, CA | 415-555-0142").name).toBe("");
  });
});

describe("skills", () => {
  it("are split only outside brackets", () => {
    expect(parse("Jane Doe\nSkills\nAWS (EC2, S3, Lambda), Docker; Go").skills).toEqual([
      "AWS (EC2, S3, Lambda)",
      "Docker",
      "Go",
    ]);
  });

  it("are still split after a bracket that never closes", () => {
    expect(parse("Jane Doe\nSkills\nAWS (EC2, S3").skills).toEqual(["AWS (EC2", "S3"]);
  });
});

describe("a stated date of birth", () => {
  it.each(["A born leader with 8 years of experience", "Born and raised in Chennai, 2 kids"])(
    "is not %j",
    (line) => expect(statesDateOfBirth([line], DEFAULT_POLICY)).toBe(false),
  );

  it.each(["Born 1990", "Date of birth: 04.05.1990", "Born: 4 May 1990", "DOB 12/05/90"])(
    "is %j",
    (line) => expect(statesDateOfBirth([line], DEFAULT_POLICY)).toBe(true),
  );
});

describe("degrees with no level", () => {
  it.each([
    ["J.D., Harvard Law School, 2015", 7],
    ["M.D., Johns Hopkins University, 2012", 7],
    ["M.Ed., Teachers College, 2011", 7],
    ["BFA, Rhode Island School of Design, 2009", 6],
    ["BBA, Ross School of Business, 2008", 6],
    ["LLB, National Law School, 2007", 6],
    ["LLM, National Law School, 2009", 7],
  ])("reads %j", (line, isced) => {
    expect(parse(`Jane Doe\nEducation\n${line}`).highestIsced).toBe(isced);
  });

  it("does not read an LLM as a Master of Laws", () => {
    const text =
      "Priya Sharma\n+91 98765 43210\nEducation\nB.Tech, IIT Delhi, 2018\nThesis: LLM-based code review assistant";
    expect(parse(text).highestIsced).toBe(6);
    expect(check(text, { region: "IN" }).highestIsced).toBe(6);
  });

  it("reads India's SSLC, II PUC and an undotted BE", () => {
    expect(
      check(
        "Priya Sharma\n+91 98765 43210\nEducation\nSSLC, Kendriya Vidyalaya, 2012\nII PUC, Vidya College, 2014\nBE Mechanical, Anna University, 2018",
        { region: "IN" },
      ).education.map((entry) => entry.isced),
    ).toEqual([2, 3, 6]);
  });

  it("reads Dr.-Ing., a Diplom (BA) and a Gesellenbrief in Germany", () => {
    expect(
      check(
        "Max Muster\n+49 30 1234567\nAusbildung\nDr.-Ing., Technische Universität Berlin, 2020\nDiplom-Betriebswirt (BA), Duale Hochschule, 2010\nGesellenbrief Elektroniker, 2005",
        { region: "DE", languages: ["de"] },
      ).education.map((entry) => entry.isced),
    ).toEqual([8, 6, 3]);
  });

  it("does not cut a German school name at the decimal comma of its grade", () => {
    expect(
      check("Max Muster\nAusbildung\nTechnische Universität München (Note 1,7)", {
        languages: ["de"],
      }).education[0].school,
    ).toBe("Technische Universität München");
  });
});

describe("links", () => {
  it("captures profiles and a .dev site without a scheme", () => {
    expect(
      parse(
        "Jane Doe\ndribbble.com/janedoe | orcid.org/0000-0002-1825-0097 | janedoe.dev | jane@janedoe.dev",
      ).links,
    ).toEqual(["dribbble.com/janedoe", "orcid.org/0000-0002-1825-0097", "janedoe.dev"]);
  });
});

describe("academic and executive CVs", () => {
  it("reads a role whose header and dates the page wrapped", () => {
    expect(
      rows(
        [
          "Jane Doe",
          "Experience",
          "Postdoctoral Research Fellow, Harvard T.H. Chan School of Public",
          "Health",
          "Aug 2018 – Aug",
          "2021",
          "- Studied cohorts",
        ].join("\n"),
      ),
    ).toMatchObject([
      {
        title: "Postdoctoral Research Fellow",
        start: { year: 2018, month: 8 },
        end: { year: 2021, month: 8 },
      },
    ]);
  });

  it("does not read grants, courses or board seats as jobs", () => {
    expect(
      rows(
        [
          "Jane Doe",
          "Academic Appointments",
          "Assistant Professor, State University 2019 - Present",
          "Grants",
          "R01 Cohort Study, National Institutes 2020 - 2025",
          "Courses Taught",
          "Biostatistics I, 2019 - 2023",
          "Board Memberships",
          "Director, Health Trust 2018 - Present",
        ].join("\n"),
      ),
    ).toMatchObject([{ title: "Assistant Professor", employer: "State University" }]);
  });
});

describe("headings and words read as names", () => {
  it("does not read a SCHOOL heading as a school", () => {
    expect(
      parse("Jane Doe\nEducation\nSCHOOL\nBS Biology, State University, 2014").education,
    ).toMatchObject([{ school: "State University", credential: "BS" }]);
  });
});

describe("new shapes stay linear", () => {
  const N = 50_000;
  it.each([
    ["two-digit year runs", "2019-21 ".repeat(N / 8)],
    ["apostrophe years", "Jan '20 - ".repeat(N / 10)],
    ["season runs", "Spring 2020 ".repeat(N / 12)],
    ["durations", "4 yrs ".repeat(N / 6)],
    ["brackets", "(a, ".repeat(N / 4)],
    ["dev hosts", "a.".repeat(N / 2)],
    ["contact spaces", `Jane Doe${" ".repeat(N)}x 1`],
    ["capital words", "VOLUNTEER WORK\n".repeat(N / 15)],
  ])("%s", (_, text) => {
    expectFast(
      () =>
        parse(`Jane Doe\nEducation\nBS, State University\nSkills\n${text}\nExperience\n${text}`),
      1500,
    );
  });
});

describe("German posting filler", () => {
  it("is not a missing keyword, while the skills and languages beside it are", () => {
    const report = AtsScoringService.check(
      "Max Muster\nmax@example.com\nBerufserfahrung\nSoftwareentwickler, Beispiel GmbH 2019 - heute\n- Entwicklung von Microservices mit Java und Kubernetes\nAusbildung\nB.Sc. Informatik, Universität Hamburg, 2018\nKenntnisse\nJava, Python",
      LOCALIZED,
      {
        now: NOW,
        jobDescription:
          "Ihr Profil\n- Abgeschlossenes Studium der Informatik oder vergleichbare Qualifikation\n- Sehr gute Kenntnisse in Java und Kubernetes sowie Erfahrung mit Terraform\n- Idealerweise Erfahrung im Bereich Cloud\n- Kenntnisse in Go wünschenswert\n- Fließende Deutschkenntnisse und gute Englischkenntnisse",
      },
    );
    expect(report.locale.languages).toContain("de");
    for (const filler of [
      "abgeschlossenes",
      "studium",
      "qualifikation",
      "vergleichbare",
      "kenntnisse",
      "erfahrung",
      "bereich",
      "sowie",
      "gute",
      "sehr",
      "idealerweise",
      "wünschenswert",
      "fließende",
    ])
      expect(report.missingKeywords).not.toContain(filler);
    expect(report.missingKeywords).toEqual(
      expect.arrayContaining(["terraform", "go", "deutschkenntnisse"]),
    );
  });
});
