import { describe, expect, it } from "vitest";

import { DEFAULT_POLICY, check } from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import { expectFast } from "../fixtures/timing.js";

const name = (text: string) => check(text, DEFAULT_POLICY).parsed.name;

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
    const { parsed } = check(linkedIn(["Kubernetes", "TypeScript", "PostgreSQL"]), DEFAULT_POLICY);
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
    const { parsed } = check(text, DEFAULT_POLICY);
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
    expect(check(text, DEFAULT_POLICY).parsed.skills).toEqual([
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
    const { parsed } = check(listFirst(list, rest), DEFAULT_POLICY);
    expect(parsed.name).toBe("Jane Doe");
    expect(parsed.skills).not.toContain("Jane Doe");
  });

  it("does not take a reference over the reference's email for the name", () => {
    const text = [
      "SKILLS",
      "Python",
      "Go",
      "REFERENCES",
      "John Smith",
      "john@acme.com",
      "Jane Doe",
      "Software Engineer",
      "EXPERIENCE",
      "Software Engineer, Acme Corp    2019 – 2022",
    ].join("\n");
    expect(name(text)).toBe("Jane Doe");
  });

  it("keeps the certifications under the name's list heading", () => {
    const { parsed } = check(
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
    const { parsed } = check(text, DEFAULT_POLICY);
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
    const { roles } = check(text, DEFAULT_POLICY, {
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

describe("a name with its headline on the first line", () => {
  const top = (first: string, second = "mira.kestrel@example.com | +1 415 555 0134") =>
    `${first}\n${second}\nEXPERIENCE\nSenior Software Engineer, Globex Corp\tJan 2020 - Present\n- Built dashboards used by 40 teams`;

  it.each([
    ["Mira Kestrel | Senior Software Engineer", "Mira Kestrel"],
    ["Mira Kestrel — Senior Software Engineer", "Mira Kestrel"],
    ["Mira Kestrel - Senior Software Engineer", "Mira Kestrel"],
    ["MIRA KESTREL · Data Analyst", "MIRA KESTREL"],
    ["Mira Kestrel, Senior Software Engineer", "Mira Kestrel"],
    // Surname first, read in the order the name is spoken.
    ["Kestrel, Mira", "Mira Kestrel"],
    ["Kestrel, Mira, PhD", "Mira Kestrel"],
  ])("reads %j as %j", (first, expected) => {
    expect(name(top(first))).toBe(expected);
  });

  it.each([
    "Senior Software Engineer",
    "Data Analyst | Senior Software Engineer",
    "Experience | Skills",
    "Berlin, Germany",
    // An employer before the title, and a row of skills, have a name's shape.
    "Acme Corp | Senior Engineer",
    "Globex Inc. — Data Analyst",
    "Python, Go",
    "Kubernetes, Docker",
    // "Surname, Given" is read only when the email or a profile link spells it.
    "Java, Spring",
    "Excel, PowerPoint",
    "Sales, Marketing",
    "Agile, Scrum",
    "Remote, Worldwide",
    "Munich, Bavaria",
    "Lyon, Rhône",
    "Professional, Reliable",
    "Husband, Father",
    // A tagline before a title: the part before it is a name only when the email spells it.
    "New York | Software Engineer",
    "United States | Software Engineer",
    "Hong Kong | Analyst",
    "Machine Learning | Data Scientist",
    "San Francisco | Software Engineer",
    "Career Objective | Engineer",
    "Hire Me | Engineer",
  ])("reads no name from a line that is only a title, a heading or a place: %j", (first) => {
    expect(name(top(first))).toBe("");
  });

  it("reads a name under a line that only looks surname-first", () => {
    expect(name(top("Bengaluru, Karnataka", "Priya Raman"))).toBe("Priya Raman");
  });

  it.each([
    ["KESTREL, MIRA", "mira.kestrel@example.com | +1 415 555 0134"],
    ["Kestrel, Mira", "mkestrel@example.com | +1 415 555 0134"],
    ["Kestrel, Mira", "linkedin.com/in/mira-kestrel | +1 415 555 0134"],
    ["Smith, Jane", "linkedin.com/in/jane-smith"],
  ])("reads %j surname first when %j spells it", (first, second) => {
    const [surname, given] = first.split(", ");
    expect(name(top(first, second))).toBe(`${given} ${surname}`);
  });

  it.each([
    "jd1987@example.com | +1 415 555 0134",
    // Every word is spelled, not one of them.
    "mira@example.com | +1 415 555 0134",
  ])("reads no name surname first that %j does not spell", (second) => {
    expect(name(top("Kestrel, Mira", second))).toBe("");
  });

  // A city and its state, or two skills, have the shape of "Surname, Given": that reading never
  // outranks a name further down, and a state code is never a given name.
  it.each([
    ["Austin, TX", "austin.lee@example.com"],
    ["Charlotte, NC", "charlotte.h@example.com"],
    ["Jackson, MS", "jackson.lee@example.com"],
    ["Madison, WI", "madison.k@example.com"],
    ["Sydney, NSW", "sydney.chen@example.com"],
    ["Adelaide, SA", "adelaide@example.com"],
    ["Java, Spring", "java.dev@example.com"],
    ["Python, Django", "python.jane@example.com"],
    ["Sales, Marketing", "sales@example.com"],
    ["Remote, Worldwide", "jane.remote@example.com"],
    ["Hello, World", "hello@janedoe.com"],
    ["Resume, Updated", "jane.resume@example.com"],
    ["Austin, TX", "austin.tx@example.com"],
    ["Lee, Robert", "robert.e.lee@example.com"],
    ["Smith, Jane", "linkedin.com/in/jane-smith"],
  ])("never reads %j (with %j) surname first over the name below it", (first, second) => {
    const [surname, given] = first.split(", ");
    const over = name(top(`${first}\nJane Doe`, second));
    // As 0.16.0, "Sydney, NSW" reads as "Sydney" with a credential.
    expect(over).toBe(["Sydney", "Adelaide"].includes(surname!) ? surname : "Jane Doe");
    if (given === given!.toUpperCase()) expect(name(top(first, second))).not.toContain(given);
  });

  it.each([
    ["linkedin.com/in/mira-kestrel | +1 415 555 0134"],
    ["linkedin.com/in/mira-kestrel-12ab | +1 415 555 0134"],
    ["https://www.linkedin.com/in/mira-kestrel/ | +1 415 555 0134"],
    ["mkestrel@example.com | +1 415 555 0134"],
  ])("reads a name before a title that %j spells", (linked) => {
    expect(name(top("Mira Kestrel | Senior Software Engineer", linked))).toBe("Mira Kestrel");
  });

  // A city with its state is the weakest reading of all (0.16.0 read "San Francisco").
  it.each(["Mira Kestrel | Senior Software Engineer", "Kestrel, Mira"])(
    "reads %j over a city and its state",
    (first) => {
      expect(name(top(`${first}\nSan Francisco, CA`))).toBe("Mira Kestrel");
    },
  );

  it("reads no name before a title when the contact spells only one of its words", () => {
    expect(name(top("Mira Kestrel | Senior Software Engineer", "mira@example.com"))).toBe("");
  });

  // The email or a profile link spells one word of a tagline, a city or an employer: the name is
  // the one under it, as in 0.16.0, and there is none without one.
  it.each([
    ["San Francisco | Software Engineer", "Francisco Lopez", "francisco.lopez@example.com"],
    ["San Jose | Software Engineer", "Jose Ramirez", "jose.ramirez@example.com"],
    ["San Diego | Data Analyst", "Diego Torres", "diego.torres@example.com"],
    ["Santa Clara | Product Manager", "Clara Weiss", "clara.weiss@example.com"],
    ["St. Louis | Software Engineer", "Louis Martin", "louis.martin@example.com"],
    ["Los Angeles | Software Engineer", "Carlos Angeles", "carlos.angeles@example.com"],
    ["Port Elizabeth | Engineer", "Elizabeth Naidoo", "elizabeth.naidoo@example.com"],
    ["Mount Vernon | Analyst", "Vernon Price", "vernon@example.com"],
    ["Morgan Stanley | Associate", "Morgan Lee", "morgan.lee@example.com"],
    ["Wells Fargo | Analyst", "Sam Wells", "sam.wells@example.com"],
    ["Goldman Sachs | Analyst", "Rachel Goldman", "rachel.goldman@example.com"],
    ["Ford Motor | Mechanical Engineer", "Henry Ford", "henry.ford@example.com"],
    ["Ernst Young | Auditor", "Ernst Becker", "ernst.becker@example.com"],
    ["Jane Street | Quant Researcher", "Jane Doe", "jane.doe@example.com"],
    ["Doe Family | Software Engineer", "Jane Doe", "jane.doe@example.com"],
    ["Cloud Native | DevOps Engineer", "Jane Cloud", "jane.cloud@example.com"],
    ["Hello World | Software Engineer", "Jane Doe", "hello@janedoe.com"],
    ["Full Stack | Software Engineer", "Jane Doe", "jane.fullstack@example.com"],
    // Words of a link's address, not of its owner.
    [
      "Based In Berlin | Software Engineer",
      "Jane Doe",
      "jane@example.com · linkedin.com/in/jane-doe",
    ],
    ["Linked In | Software Engineer", "Jane Doe", "jane@example.com · linkedin.com/in/jane-doe"],
    ["Github Star | Software Engineer", "Jane Doe", "jane@example.com · github.com/janedoe"],
    ["Medium Writer | Software Engineer", "Jane Doe", "jane@example.com · medium.com/@janedoe"],
  ])(
    "takes the name under %j, not the line, when it is spelled in part",
    (tag, person, contact) => {
      expect(name(top(`${tag}\n${person}`, contact))).toBe(person);
      expect(name(top(tag, contact))).toBe("");
    },
  );

  // A tagline (`resumeParse.notNames`) or a term the policy knows is no name, though the email or
  // a link spells every word of it.
  it.each([
    ["Open Source", "github.com/open-source"],
    ["Machine Learning", "machine.learning@example.com"],
    ["Data Science", "linkedin.com/in/data-science"],
    ["Full Stack", "full.stack@example.com"],
    ["Cloud Native", "github.com/cloud-native"],
  ])("reads no name from the term %j before a title, though %j spells it", (term, contact) => {
    expect(name(top(`${term} | Software Engineer`, contact))).toBe("");
    expect(name(top(`${term} | Software Engineer\nMira Kestrel`, contact))).toBe("Mira Kestrel");
    const [given, surname] = term.split(" ");
    expect(name(top(`${surname}, ${given}`, contact))).toBe("");
    expect(name(top(`${surname}, ${given}\nMira Kestrel`, contact))).toBe("Mira Kestrel");
  });

  // A name holding a word that is a skill ("Go", "Vue", "Spark", "Rust") is still a name.
  it.each([
    ["Sean Go | Software Engineer", "sean.go@example.com", "Sean Go"],
    ["Go Min-jun – Data Scientist", "linkedin.com/in/go-minjun", "Go Min-jun"],
    ["Go, Sean", "sean.go@example.com", "Sean Go"],
    ["Vue Nguyen | Software Engineer", "vue.nguyen@example.com", "Vue Nguyen"],
    ["Spark Lee | Software Engineer", "spark.lee@example.com", "Spark Lee"],
    ["Rust Cohle | Software Engineer", "rust.cohle@example.com", "Rust Cohle"],
    ["Cohle, Rust", "rust.cohle@example.com", "Rust Cohle"],
  ])("reads the name in %j, which %j spells", (line, contact, expected) => {
    expect(name(top(line, contact))).toBe(expected);
  });

  it("takes the name under a tagline the email spells in part", () => {
    expect(name(top("Data Science | Machine Learning Engineer\nJane Doe", "data.jane@x.com"))).toBe(
      "Jane Doe",
    );
  });

  it("stays linear on a long line before a title and a long profile link that spells it", () => {
    const words = Array.from({ length: 4_000 }, (_, i) =>
      [26 ** 2, 26, 1]
        .map((unit) => String.fromCharCode(97 + (Math.floor(i / unit) % 26)))
        .join(""),
    );
    const line = words.map((word) => `X${word}`).join(" ");
    const link = `linkedin.com/in/${words
      .reverse()
      .map((word) => `x${word}`)
      .join("-")}`;
    expect(expectFast(() => name(`${line} | Software Engineer\n${link}`), 500)).toBe("");
  });

  // As 0.16.0: nothing tells a name before a title from a tagline there.
  it("reads no name before a title that nothing else on the page spells", () => {
    const unspelled = "jd1987@example.com | +1 415 555 0134";
    expect(name(top("Mira Kestrel | Engineer", unspelled))).toBe("");
  });

  // A tagline over the name, with a title after it, has the shape of "Name | Title".
  it.each([
    "Los Angeles",
    "San Francisco",
    "Hong Kong",
    "New Delhi",
    "United States",
    "Bay Area",
    "Open Source",
    "About Me",
    "Data Science",
    "Machine Learning",
    "US Citizen",
    "Top Secret",
    "Career Objective",
    "Personal Profile",
    "Available Immediately",
    "Team Player",
  ])("takes the name under a tagline %j before a title", (tagline) => {
    expect(name(top(`${tagline} | Software Engineer\nJane Doe`))).toBe("Jane Doe");
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

// Review finding (2026-10-24): "Dr. Miriam Hoffmann" and "डॉ. अंजलि मिश्रा" kept the honorific.
describe("an honorific before the name", () => {
  it.each([
    ["Dr. Jane Doe", "Jane Doe"],
    ["Dr Jane Doe, PhD", "Jane Doe"],
    ["Ms Mira Kestrel", "Mira Kestrel"],
    ["DR. JANE DOE", "JANE DOE"],
    ["Prof. Mira Kestrel", "Mira Kestrel"],
  ])("reads %s as %s", (line, want) => {
    expect(name(`${line}\njane.doe@example.com`)).toBe(want);
  });

  it.each([
    // Initials, not an honorific, before mixed case.
    ["MS Dhoni", "MS Dhoni"],
    // One word would be left: the honorific stays.
    ["Mr Kestrel", "Mr Kestrel"],
    ["Drew Barrymore", "Drew Barrymore"],
  ])("keeps %s", (line, want) => {
    expect(name(`${line}\nms.dhoni@example.com`)).toBe(want);
  });

  it.each([
    ["de", "Prof. Dr. med. Anna Schmidt", "Anna Schmidt"],
    ["de", "Dipl.-Ing. Hans Müller", "Hans Müller"],
    ["es", "Lic. Ana Sofía Ramírez", "Ana Sofía Ramírez"],
    ["pt", "Dra. Inês Sousa", "Inês Sousa"],
    ["fr", "Mme Claire Martin", "Claire Martin"],
    ["fr", "M. Kestrel Dupont", "M. Kestrel Dupont"],
    ["hi", "डॉ. अंजलि मिश्रा", "अंजलि मिश्रा"],
  ])("reads a %s honorific: %s", (language, line, want) => {
    const policy = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
    expect(
      check(`${line}\nperson@example.org`, policy, { languages: [language] }).parsed.name,
    ).toBe(want);
  });
});
