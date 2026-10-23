import { describe, expect, it } from "vitest";

import {
  ATS_DOCUMENT_FORMAT,
  AtsInputError,
  DEFAULT_POLICY,
  fromJsonResume,
  isJsonResume,
  prepareResume,
  renderResumeDocument,
  type AtsResumeDocument,
  check as score,
} from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import { expectFast } from "../fixtures/timing.js";

const NOW = new Date("2026-09-30T00:00:00Z");
const check = (input: Parameters<typeof score>[0], jobDescription?: string) =>
  score(input, DEFAULT_POLICY, { jobDescription, now: NOW });

const DOCUMENT: AtsResumeDocument = {
  format: ATS_DOCUMENT_FORMAT,
  basics: {
    name: "Jane Doe",
    headline: "Senior Engineer",
    email: "jane@example.com",
    phone: "+1 415 555 0142",
    links: ["https://linkedin.com/in/janedoe"],
  },
  sections: [
    { kind: "summary", title: "Summary", text: "Backend engineer building payment systems." },
    {
      kind: "experience",
      title: "Experience",
      items: [
        {
          title: "Senior Software Engineer",
          employer: "Acme Corp",
          start: "2020-01",
          current: true,
          highlights: [
            "Built a payments platform serving 2M users",
            "Led a team of 6 engineers and reduced latency by 40%",
          ],
        },
        {
          title: "Software Engineer",
          employer: "Globex",
          start: "2016-06",
          end: "2019-12",
          highlights: ["Automated CI/CD for 12 repositories"],
        },
      ],
    },
    {
      kind: "education",
      title: "Education",
      items: [
        { school: "State University", credential: "BSc", field: "Computer Science", end: "2016" },
      ],
    },
    {
      kind: "skills",
      title: "Skills",
      items: [{ name: "Languages", keywords: ["TypeScript", "Go"] }],
    },
  ],
};

describe("structured document input", () => {
  it("reads the record from the fields, not from re-parsing text", () => {
    const { parsed } = check(DOCUMENT);

    expect(parsed.roles).toEqual([
      {
        title: "Senior Software Engineer",
        employer: "Acme Corp",
        start: { year: 2020, month: 1 },
        end: null,
        current: true,
      },
      {
        title: "Software Engineer",
        employer: "Globex",
        start: { year: 2016, month: 6 },
        end: { year: 2019, month: 12 },
        current: false,
      },
    ]);
    expect(parsed.education[0]).toMatchObject({ school: "State University", isced: 6 });
    expect(parsed.skills).toEqual(["TypeScript", "Go"]);
    expect(parsed.monthsOfExperience).toBe(124);
    expect(parsed.provenance).toEqual({
      name: "structured",
      email: "structured",
      phone: "structured",
      roles: "structured",
      education: "structured",
      skills: "structured",
      certifications: "none",
      spokenLanguages: "none",
    });
  });

  it("scores the rendered page, with its real section headings", () => {
    const report = check(DOCUMENT);
    for (const id of [
      "ats-v2.structure.experience",
      "ats-v2.structure.education",
      "ats-v2.structure.skills",
    ])
      expect(report.rules.find((rule) => rule.id === id)?.passed, id).toBe(true);
  });

  it("scores the same as the JSON-serialised document does not", () => {
    // A stringified document has no headings and no roles.
    const structured = check(DOCUMENT);
    const stringified = check(JSON.stringify(DOCUMENT));
    expect(structured.readinessScore).toBeGreaterThan(stringified.readinessScore);
    expect(stringified.parsed.roles).toHaveLength(0);
  });

  it("drops an implausible date instead of scoring it", () => {
    const doc: AtsResumeDocument = {
      ...DOCUMENT,
      sections: [
        {
          kind: "experience",
          title: "Experience",
          items: [{ title: "Engineer", employer: "Acme", start: "0202-01" }],
        },
      ],
    };
    expect(check(doc).parsed.roles[0]!.start).toBeNull();
  });

  it("reports empty fields as provenance none", () => {
    const doc: AtsResumeDocument = {
      format: ATS_DOCUMENT_FORMAT,
      basics: { name: "Jane Doe" },
      sections: [],
    };
    const { provenance } = check(doc).parsed;
    expect(provenance.name).toBe("structured");
    expect(provenance.roles).toBe("none");
  });

  it("renders an education entry's description, as the printed page shows it", () => {
    const document: AtsResumeDocument = {
      ...DOCUMENT,
      sections: [
        {
          kind: "education",
          title: "Education",
          items: [{ school: "State University", summary: "Thesis on distributed consensus." }],
        },
      ],
    };
    expect(renderResumeDocument(document)).toContain(
      "State University\nThesis on distributed consensus.",
    );
  });

  it("omits the heading of a section with nothing in it", () => {
    const text = renderResumeDocument({
      format: ATS_DOCUMENT_FORMAT,
      basics: { name: "Jane Doe" },
      sections: [{ kind: "experience", title: "Experience", items: [] }],
    });
    expect(text).toBe("Jane Doe");
  });
});

describe("input validation", () => {
  it("rejects a document that claims the format but breaks it", () => {
    const broken = { format: ATS_DOCUMENT_FORMAT, basics: { name: 42 }, sections: [] };
    expect(() => prepareResume(broken)).toThrow(AtsInputError);
    try {
      prepareResume(broken);
    } catch (error) {
      expect((error as AtsInputError).issues[0]?.path).toBe("basics.name");
    }
  });

  it("bounds arrays so a caller cannot make the engine walk them", () => {
    const huge = {
      ...DOCUMENT,
      sections: Array.from({ length: 1_000 }, () => ({ kind: "summary", title: "S", text: "x" })),
    };
    expect(() => prepareResume(huge)).toThrow(AtsInputError);
  });

  it("still flattens an arbitrary object without the format field", () => {
    expect(prepareResume({ experience: [{ company: "Acme" }] }).text).toBe(
      "experience\ncompany\nAcme",
    );
  });

  it("returns a prepared resume unchanged, so a host prepares once", () => {
    const prepared = prepareResume(DOCUMENT);
    expect(prepareResume(prepared)).toBe(prepared);
    expect(check(prepared)).toEqual(check(DOCUMENT));
  });

  it("stops flattening once the text budget is spent", () => {
    const big = { items: Array.from({ length: 200_000 }, (_, i) => `entry ${i}`) };
    expect(expectFast(() => prepareResume(big), 500).text.length).toBeLessThanOrEqual(50_000);
  });
});

describe("JSON Resume", () => {
  const jsonResume = {
    basics: {
      name: "Richard Hendriks",
      label: "Programmer",
      email: "richard@piedpiper.example",
      phone: "(912) 555-4321",
      url: "https://richardhendricks.example.com",
      location: { city: "San Francisco", region: "California" },
      profiles: [{ network: "Twitter", url: "https://twitter.example/neutralthoughts" }],
      summary: "Richard hails from Tulsa.",
    },
    work: [
      {
        name: "Pied Piper",
        position: "CEO/President",
        startDate: "2013-12-01",
        highlights: [
          "Build an algorithm for artist to detect if their music was violating copyright",
        ],
      },
      { name: "Hooli", position: "Engineer", startDate: "2011", endDate: "2013-11" },
    ],
    education: [
      {
        institution: "University of Oklahoma",
        area: "Information Technology",
        studyType: "Bachelor",
        endDate: "2013-01-01",
      },
    ],
    skills: [{ name: "Web Development", keywords: ["HTML", "CSS", "JavaScript"] }],
    certificates: [
      { name: "Certified Kubernetes Administrator", issuer: "CNCF", date: "2021-11-07" },
    ],
    languages: [{ language: "English", fluency: "Native speaker" }],
  };

  it("maps every section to the document format", () => {
    const doc = fromJsonResume(jsonResume);

    expect(doc.basics).toEqual({
      name: "Richard Hendriks",
      headline: "Programmer",
      email: "richard@piedpiper.example",
      phone: "(912) 555-4321",
      location: "San Francisco, California",
      links: ["https://richardhendricks.example.com", "https://twitter.example/neutralthoughts"],
    });
    expect(doc.sections.map((section) => section.title)).toEqual([
      "Summary",
      "Experience",
      "Education",
      "Skills",
      "Certifications",
      "Languages",
    ]);
  });

  it("treats a missing end date as a current role and drops the day from dates", () => {
    const { parsed } = check(fromJsonResume(jsonResume));
    expect(parsed.roles[0]).toMatchObject({
      employer: "Pied Piper",
      current: true,
      start: { year: 2013, month: 12 },
    });
    expect(parsed.roles[1]).toMatchObject({ employer: "Hooli", end: { year: 2013, month: 11 } });
    expect(parsed.highestIsced).toBe(6);
  });

  it("reads a malformed file as empty rather than throwing", () => {
    const doc = fromJsonResume({ basics: "nope", work: [42, null, { name: 7 }], skills: {} });
    expect(doc.basics.name).toBe("");
    expect(doc.sections).toEqual([]);
    expect(() => check(doc)).not.toThrow();
  });
});

describe("JSON Resume through the engine's front door", () => {
  const jsonResume = {
    basics: { name: "Ada Lovelace", email: "ada@example.com" },
    work: [{ name: "Analytical Engines Ltd", position: "Programmer", startDate: "1842-01" }],
    education: [{ institution: "University of London", studyType: "Master" }],
  };

  it("is recognised by shape and read as structure", () => {
    const prepared = prepareResume(jsonResume);
    expect(prepared.document?.basics.name).toBe("Ada Lovelace");
    const { parsed } = check(jsonResume);
    expect(parsed.provenance.roles).toBe("structured");
    expect(parsed.roles[0]).toMatchObject({
      employer: "Analytical Engines Ltd",
      title: "Programmer",
    });
  });

  it("keeps the structure of a file with an over-long field, cutting the field to size", () => {
    const oversized = { ...jsonResume, basics: { name: "x".repeat(1_000) } };
    const prepared = prepareResume(oversized);
    expect(prepared.document?.basics.name).toHaveLength(200);
    expect(prepared.document?.sections[0]?.kind).toBe("experience");
  });

  it("treats an end date of Present as a current role", () => {
    const doc = fromJsonResume({
      basics: { name: "A" },
      work: [
        {
          name: "Acme",
          position: "Engineer",
          startDate: "2020-01-15T00:00:00Z",
          endDate: "Present",
        },
      ],
    });
    const role = doc.sections[0]?.kind === "experience" ? doc.sections[0].items[0] : undefined;
    expect(role).toMatchObject({ start: "2020-01", end: undefined, current: true });
  });

  // Only English "Present" and its kin made a role current; "heute" gave a one-month role.
  it.each([
    ["Current role", []],
    ["Current position", []],
    ["Till now", []],
    ["Present.", []],
    ["- Present", []],
    ["Continuing", []],
    ["heute", ["de"]],
    ["bis heute", ["de"]],
    ["aujourd'hui", ["fr"]],
    ["अभी तक", ["hi"]],
  ])("treats an end of %j as a current role", (endDate, languages) => {
    const resume = {
      basics: { name: "Jane Doe", email: "jane@example.com" },
      work: [{ name: "Acme", position: "Engineer", startDate: "2019-01", endDate }],
    };
    const report = score(resume, withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES), {
      now: NOW,
      languages: languages as string[],
    });
    expect(report.parsed.roles[0]).toMatchObject({ current: true, end: null });
    expect(report.parsed.monthsOfExperience).toBeGreaterThanOrEqual(92);
  });

  // Only an end that is an open end as a whole is current: one that opens with one and goes on
  // ("Current role ended 2020", "Heute nicht") is no end.
  it.each([
    ["soon", []],
    ["Not current", []],
    ["No longer current", []],
    ["Current role ended 2020", []],
    ["Till now (contract ended)", []],
    ["Present 2021", []],
    ["Now closed", []],
    ["Ongoing until Mar 2021", []],
    ["Continuing until 2020", []],
    ["Current: no", []],
    ["Present?", []],
    ["Heute nicht", ["de"]],
    ["jetzt nicht mehr", ["de"]],
    ["से", ["hi"]],
    ["present-ish", []],
    ["Today: left in 2022", []],
    ["Now-defunct startup", []],
    ["Present, 2022", []],
    ["से 2022 तक", ["hi"]],
  ])("still reads an end of %j as no end, not as current", (endDate, languages) => {
    const policy = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
    const options = { now: NOW, languages: languages as string[] };
    const resume = {
      basics: { name: "Jane Doe" },
      work: [{ name: "Acme", position: "Engineer", startDate: "2019-01", endDate }],
    };
    expect(score(resume, policy, options).parsed.roles[0]).toMatchObject({
      current: false,
      end: null,
    });
    // The engine's own format reads its end the same way.
    const document: AtsResumeDocument = {
      format: ATS_DOCUMENT_FORMAT,
      basics: { name: "Jane Doe" },
      sections: [
        {
          kind: "experience",
          title: "Experience",
          items: [{ title: "Engineer", employer: "Acme", start: "2019-01", end: endDate }],
        },
      ],
    };
    expect(score(document, policy, options).parsed.roles[0]).toMatchObject({
      current: false,
      end: null,
    });
  });

  it("reads only a bounded slice of a huge array", () => {
    const huge = {
      basics: { name: "A" },
      work: Array.from({ length: 500_000 }, () => ({ name: "Acme", position: "Engineer" })),
    };
    const prepared = expectFast(() => prepareResume(huge), 500);
    expect(prepared.document?.sections[0]?.kind).toBe("experience");
  });

  // The arrays were cut to 200 before empty entries were dropped: 200 empty ones hid every real one.
  it("drops empty entries before cutting an array to its limit", () => {
    const resume = {
      basics: { name: "Mira Kestrel" },
      work: [
        ...Array.from({ length: 250 }, () => ({})),
        null,
        { startDate: "2010-01" },
        {
          name: "Globex Corp",
          position: "Engineer",
          startDate: "2019-01",
          highlights: [...Array<string>(120).fill(""), "Built dashboards used by 40 teams"],
        },
      ],
    };
    const { parsed } = check(resume);
    expect(parsed.roles).toMatchObject([{ employer: "Globex Corp", title: "Engineer" }]);
    expect(prepareResume(resume).text).toContain("Built dashboards used by 40 teams");
    // An array of nothing but empty entries is walked once, in linear time.
    const empty = { basics: { name: "A" }, work: Array.from({ length: 200_000 }, () => ({})) };
    expect(expectFast(() => prepareResume(empty), 500).document?.sections).toEqual([]);
  });

  const role = { name: "Globex Corp", position: "Engineer", startDate: "2019-01" };

  // These were flattened to text, which reads no role.
  it.each([
    ["no basics", { work: [role] }],
    ["basics that is not an object", { basics: "Mira Kestrel", work: [role] }],
    ["work as one object", { basics: { name: "Mira Kestrel" }, work: role }],
    ["no basics and work as one object", { work: role, education: [] }],
  ])("reads a file with %s as structure", (_, resume) => {
    expect(prepareResume(resume).document).not.toBeNull();
    expect(check(resume).parsed.roles).toMatchObject([
      { employer: "Globex Corp", title: "Engineer" },
    ]);
  });

  // Read as text, such a file gave its name; read as structure, it was lost.
  it("reads basics that are only a name as the name", () => {
    expect(check({ basics: "Mira Kestrel", work: [role] }).parsed.name).toBe("Mira Kestrel");
    // A name in a script without case is one run of characters.
    expect(check({ basics: "王小明", work: [role] }).parsed.name).toBe("王小明");
    // Particles between the capitalised words, as 0.16.0 read them.
    expect(check({ basics: "Pieter van der Berg", work: [role] }).parsed.name).toBe(
      "Pieter van der Berg",
    );
    expect(check({ basics: "Ana de la Cruz", work: [role] }).parsed.name).toBe("Ana de la Cruz");
  });

  // Held to the checks a name on a page gets: a headline or a heading is not one.
  it.each(["Senior Software Engineer", "Work Experience", "Software Engineer at Hooli"])(
    "reads no name from basics that are only %j",
    (basics) => {
      expect(check({ basics, work: [role] }).parsed.name).toBe("");
    },
  );

  it("still flattens an object without basics whose roles are not spelled as JSON Resume's", () => {
    const other = { name: "Mira Kestrel", work: [{ company: "Globex Corp", title: "Engineer" }] };
    expect(prepareResume(other).document).toBeNull();
    expect(prepareResume(other).text).toContain("Mira Kestrel");
  });

  it("is not triggered by an object that merely has a basics key", () => {
    expect(prepareResume({ basics: { name: "A" } }).document).toBeNull();
  });

  it("is not triggered by a document in another format that shares its section names", () => {
    // Has basics, education and skills but nothing distinctive to JSON Resume.
    const studioShaped = {
      basics: { fullName: "Jane Doe", email: "jane@x.com" },
      experience: [{ company: "Acme", role: "Engineer" }],
      education: [{ school: "State University", degree: "Bachelor of Science" }],
      skills: [{ name: "Languages", keywords: ["Go"] }],
    };
    expect(isJsonResume(studioShaped)).toBe(false);
    expect(prepareResume(studioShaped).text).toContain("Jane Doe");
  });
});

describe("structured input size", () => {
  it("rejects a huge document cheaply, before validating it", () => {
    for (const huge of [
      { format: ATS_DOCUMENT_FORMAT, basics: { name: "A" }, sections: Array(1_300_000).fill({}) },
      {
        format: ATS_DOCUMENT_FORMAT,
        basics: { name: "A", links: Array(1_900_000).fill(0) },
        sections: [],
      },
      {
        format: ATS_DOCUMENT_FORMAT,
        basics: { name: "A" },
        sections: [{ kind: "experience", title: "E", items: Array(1_300_000).fill({}) }],
      },
    ]) {
      expectFast(() => expect(() => prepareResume(huge)).toThrow(AtsInputError), 200);
    }
  });

  it("cuts an over-long description instead of refusing the resume", () => {
    const doc: AtsResumeDocument = {
      format: ATS_DOCUMENT_FORMAT,
      basics: { name: "Jane Doe" },
      sections: [{ kind: "other", title: "Achievements", items: [{ lines: ["x".repeat(6_000)] }] }],
    };
    expect(prepareResume(doc).document?.sections[0]).toBeDefined();
  });

  it("keeps a title with a newline on one rendered line", () => {
    const text = renderResumeDocument({
      format: ATS_DOCUMENT_FORMAT,
      basics: { name: "Jane" },
      sections: [
        {
          kind: "experience",
          title: "Experience",
          items: [{ title: "Senior\nEngineer", employer: "Acme" }],
        },
      ],
    });
    expect(text).toContain("Senior Engineer, Acme");
  });
});
