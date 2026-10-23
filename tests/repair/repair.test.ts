import { describe, expect, it } from "vitest";

import {
  DEFAULT_POLICY,
  findGroundingViolations,
  isGrounded,
  mergeGrounded,
  needsRepair,
  normalizeForGrounding,
  type AtsParsedResume,
  type AtsRepairCandidate,
  type AtsReport,
} from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import { expectFast } from "../fixtures/timing.js";

const NOW = new Date("2026-09-30T00:00:00Z");
const merge = (deterministic: AtsParsedResume, candidate: AtsRepairCandidate, source: string) =>
  mergeGrounded(deterministic, candidate, source, { policy: DEFAULT_POLICY, now: NOW });

// Adversarial: each test is a way a model could return something it did not read.

const SOURCE = `
Jane Q. Doe
jane.doe@example.com  |  (555) 010-2020

EXPERIENCE
Senior Engineer, Acme Corporation
Jan 2020 - Present
Built the thing.

Engineer, Globex Ltd
2017 - 2019

EDUCATION
BSc Computer Science, University of Somewhere
`;

describe("grounding: values must occur in the source", () => {
  it("accepts a value copied verbatim", () => {
    expect(isGrounded("Acme Corporation", normalizeForGrounding(SOURCE))).toBe(true);
  });

  it("rejects a plausible employer that is not in the document", () => {
    // A real-sounding company nobody wrote down.
    expect(isGrounded("Initech", normalizeForGrounding(SOURCE))).toBe(false);
  });

  it("rejects an expanded abbreviation the document never contained", () => {
    expect(isGrounded("Globex Limited", normalizeForGrounding(SOURCE))).toBe(false);
  });

  it("accepts a value whose casing the model normalised", () => {
    expect(isGrounded("acme corporation", normalizeForGrounding(SOURCE))).toBe(true);
  });

  it("accepts a value split across a line break in the source", () => {
    const wrapped = normalizeForGrounding("Senior Engineer,\nAcme Corp\noration");
    expect(isGrounded("Acme Corporation", wrapped)).toBe(true);
  });

  it("does not let a two-character value match inside an unrelated word", () => {
    // "it" occurs inside "Built" - a naive substring check would call this grounded.
    expect(isGrounded("it", normalizeForGrounding(SOURCE))).toBe(false);
  });

  it("treats an empty value as asserting nothing", () => {
    expect(isGrounded("", normalizeForGrounding(SOURCE))).toBe(true);
  });
});

describe("grounding: walking a returned object", () => {
  it("reports the path of every ungrounded string", () => {
    const violations = findGroundingViolations(
      {
        name: "Jane Q. Doe",
        roles: [
          { title: "Senior Engineer", employer: "Acme Corporation" },
          { title: "Principal Engineer", employer: "Initech" },
        ],
      },
      SOURCE,
    );

    expect(violations.map((violation) => violation.path).sort()).toEqual([
      "roles[1].employer",
      "roles[1].title",
    ]);
  });

  it("ignores numbers and booleans, which carry no fabricated identity", () => {
    const violations = findGroundingViolations(
      { roles: [{ employer: "Acme Corporation", current: true, start: { year: 2020, month: 1 } }] },
      SOURCE,
    );
    expect(violations).toEqual([]);
  });

  it("covers fields added later without being listed here", () => {
    // The walk is generic, so a new field is checked too.
    const violations = findGroundingViolations({ somethingAddedLater: "Initech" }, SOURCE);
    expect(violations).toEqual([{ path: "somethingAddedLater", value: "Initech" }]);
  });
});

const emptyParsed: AtsParsedResume = {
  name: "",
  email: "",
  phone: "",
  links: [],
  roles: [],
  education: [],
  skills: [],
  certifications: [],
  spokenLanguages: [],
  monthsOfExperience: null,
  highestIsced: null,
  provenance: {
    name: "none",
    email: "none",
    phone: "none",
    roles: "none",
    education: "none",
    skills: "none",
    certifications: "none",
    spokenLanguages: "none",
  },
};

describe("merge: a record from before certifications and languages were read", () => {
  it("keeps working, with the new rows empty", () => {
    const { certifications, spokenLanguages, provenance, ...older } = emptyParsed;
    void certifications;
    void spokenLanguages;
    const { merged } = merge(
      { ...older, provenance } as AtsParsedResume,
      candidate({ name: "Jane Q. Doe" }),
      SOURCE,
    );
    expect(merged).toMatchObject({ name: "Jane Q. Doe", certifications: [], spokenLanguages: [] });
  });
});

const candidate = (overrides: Partial<AtsRepairCandidate> = {}): AtsRepairCandidate => ({
  name: "",
  email: "",
  phone: "",
  roles: [],
  education: [],
  skills: [],
  ...overrides,
});

describe("merge: AI values only fill gaps, and only when grounded", () => {
  it("fills a field the deterministic parser missed", () => {
    const { merged } = merge(emptyParsed, candidate({ name: "Jane Q. Doe" }), SOURCE);
    expect(merged.name).toBe("Jane Q. Doe");
  });

  it("never overwrites a value the deterministic parser already found", () => {
    const { merged } = merge(
      { ...emptyParsed, name: "Jane Q. Doe" },
      candidate({ name: "Jane Doe" }),
      SOURCE,
    );
    expect(merged.name).toBe("Jane Q. Doe");
  });

  it("drops a hallucinated employer instead of merging it", () => {
    const { merged, violations } = merge(
      emptyParsed,
      candidate({
        roles: [
          { title: "Senior Engineer", employer: "Initech", start: null, end: null, current: false },
        ],
      }),
      SOURCE,
    );

    expect(violations).toEqual([{ path: "roles[0].employer", value: "Initech" }]);
    expect(merged.roles[0]!.employer).toBe("");
    expect(merged.roles[0]!.title).toBe("Senior Engineer");
  });

  it("drops a role entirely when neither of its identifying fields is grounded", () => {
    const { merged } = merge(
      emptyParsed,
      candidate({
        roles: [
          {
            title: "Chief Fabricator",
            employer: "Initech",
            start: null,
            end: null,
            current: false,
          },
        ],
      }),
      SOURCE,
    );
    expect(merged.roles).toEqual([]);
  });

  // Any words of the resume grounded, so text planted in it could fill a contact field with junk.
  it.each([
    ["email", "Acme Corporation"],
    ["email", "jane.doe"],
    ["phone", "Senior Engineer"],
    ["phone", "2017 - 2019"],
    ["name", "jane.doe@example.com"],
    ["name", "(555) 010-2020"],
    // Planted junk with a phone's characters, or a name's capitals.
    ["phone", "2019 2020 2021"],
    ["phone", "192.168.100.200"],
    ["phone", "978-3-16-148410-0"],
    ["phone", "+2017 - 2019"],
    ["phone", "Years: 2019 2020 2021"],
    ["phone", "192.168.100.200 (server)"],
    ["phone", "ISBN: 978-3-16-148410-0"],
    ["phone", "Mobile: (US)"],
    ["name", "EXPERIENCE"],
    ["name", "Senior Engineer, Acme Corporation"],
    ["name", "Built the thing."],
    // A title or an organisation word leads it, or two are in it.
    ["name", "Head Chef"],
    ["name", "Lead Engineer"],
    ["name", "Acme Bank Corp"],
    ["name", "Jane Doe, Engineer"],
  ] as const)("does not put a value that is not one in %s: %j", (field, value) => {
    // Written in the resume, so only its shape keeps it out.
    const { merged } = merge(emptyParsed, candidate({ [field]: value }), `${SOURCE}\n${value}`);
    expect(merged[field]).toBe("");
  });

  // The first shape checks dropped honest values the parser had missed.
  it.each([
    ["phone", "(+44) 7700 900123"],
    ["phone", "+1 415–555–0134"],
    ["phone", "+1 (415) 555-0134 ext. 12"],
    ["phone", "+1 415 555 0134 x12"],
    ["phone", "+55 11 2019-2020"],
    ["name", "María José de la Cruz Fernández García"],
    // Tested on the raw value, these were dropped: digits and dashes of other scripts and widths
    // (Word puts U+2011 in a phone number), an extension after a comma, an area code in brackets.
    ["phone", "+1 (415) 555‑0134"],
    ["phone", "+1 415‐555‐0134"],
    ["phone", "+1 415−555−0134"],
    ["phone", "+1 415－555－0134"],
    ["phone", "+١ ٤١٥ ٥٥٥ ٠١٣٤"],
    ["phone", "＋１ ４１５ ５５５ ０１３４"],
    ["phone", "(11) 2019-2020"],
    ["phone", "+1 415 555 0134, ext. 12"],
    ["name", "Jane Doe (she/her)"],
    ["name", "John Smith 3rd"],
    ["name", "Maria da Conceição dos Santos Pereira de Oliveira e Silva"],
    ["name", "Doe, Jane"],
    ["name", "张伟"],
    ["email", "jane@bücher.de"],
    ["email", "张伟@example.cn"],
    // A surname that is a title or organisation word.
    ["name", "Maria Head"],
    ["name", "James Fellow"],
    ["name", "Anna Bank"],
    ["name", "Lena Officer"],
    ["name", "Kim Co"],
  ] as const)("fills %s with %j", (field, value) => {
    const { merged } = merge(emptyParsed, candidate({ [field]: value }), `${SOURCE}\n${value}`);
    expect(merged[field]).toBe(value);
  });

  it.each([
    ["+1 415 555 0134 (mobile)", "+1 415 555 0134"],
    ["Mobile: +1 415 555 0134", "+1 415 555 0134"],
    ["+1-415-555-0134 (US)", "+1-415-555-0134"],
    ["Tel.: (+44) 7700 900123 (WhatsApp)", "(+44) 7700 900123"],
    ["+1 415 555 0134 x12 (work)", "+1 415 555 0134 x12"],
  ])("fills the phone %j without its label", (value, expected) => {
    const { merged } = merge(emptyParsed, candidate({ phone: value }), `${SOURCE}\n${value}`);
    expect(merged.phone).toBe(expected);
  });

  it.each([
    ["Tom Cook", "Tom Cook"],
    ["Lena Partner", "Lena Partner"],
    ["Rosa Nurse", "Rosa Nurse"],
    ["Senior Engineer", ""],
    ["Chief Partner", ""],
  ])("reads %j by a policy's own title words", (value, expected) => {
    const rp = DEFAULT_POLICY.resumeParse;
    const policy = {
      ...DEFAULT_POLICY,
      resumeParse: {
        ...rp,
        titleWords: [...rp.titleWords, "cook", "partner", "nurse", "senior", "chief"],
      },
    };
    const { merged } = mergeGrounded(
      emptyParsed,
      candidate({ name: value }),
      `${SOURCE}\n${value}`,
      {
        policy,
        now: NOW,
      },
    );
    expect(merged.name).toBe(expected);
  });

  // A surname may be a title or organisation word, but not a role's title or employer.
  it.each([
    ["Software Engineer", { title: "Software Engineer", employer: "Acme" }],
    ["Initech Bank", { title: "Analyst", employer: "Initech Bank" }],
  ])("does not take the role %j for the name", (value, role) => {
    const roles = [{ ...role, start: null, end: null, current: false }];
    const { merged } = merge(emptyParsed, candidate({ name: value, roles }), `${SOURCE}\n${value}`);
    expect(merged.name).toBe("");
  });

  it("fills an email and a phone written as such", () => {
    const { merged } = merge(
      emptyParsed,
      candidate({ email: "jane.doe@example.com", phone: "(555) 010-2020" }),
      SOURCE,
    );
    expect(merged).toMatchObject({ email: "jane.doe@example.com", phone: "(555) 010-2020" });
  });

  it("judges a long contact value's shape in bounded time", () => {
    // Grounded (whitespace folds), so only the shape checks see it.
    const gap = " ".repeat(50_000);
    const source = `${SOURCE}\n1 2 Jane Doe`;
    expectFast(() => {
      const { merged } = merge(
        emptyParsed,
        candidate({ phone: `1${gap}2`, name: `Jane${gap}Doe` }),
        source,
      );
      expect(merged).toMatchObject({ phone: "", name: "" });
    }, 500);
  });

  it("keeps dates, which the schema bounds rather than the substring check", () => {
    const { merged } = merge(
      emptyParsed,
      candidate({
        roles: [
          {
            title: "Senior Engineer",
            employer: "Acme Corporation",
            start: { year: 2020, month: 1 },
            end: null,
            current: true,
          },
        ],
      }),
      SOURCE,
    );
    expect(merged.roles[0]!.start).toEqual({ year: 2020, month: 1 });
    expect(merged.roles[0]!.current).toBe(true);
  });
});

const reportWith = (parsed: Partial<AtsParsedResume>, wordCount = 400): AtsReport =>
  ({ parsed: { ...emptyParsed, ...parsed }, wordCount }) as AtsReport;

describe("trigger: repair runs only where the parse visibly failed", () => {
  it("fires when a substantial document yielded no roles at all", () => {
    expect(needsRepair(reportWith({}))).toBe(true);
  });

  it("does not fire on a short document that legitimately has no roles", () => {
    expect(needsRepair(reportWith({ name: "Jane Q. Doe", email: "j@e.com", phone: "1" }, 40))).toBe(
      false,
    );
  });

  // The merge never edits a row the parser found, so incomplete rows are not repairable.
  it("is not offered when roles were found but are incomplete", () => {
    const report = reportWith({
      name: "Jane",
      email: "j@e.com",
      phone: "555",
      roles: [
        { title: "Engineer", employer: "", start: null, end: null, current: false },
        { title: "Engineer", employer: "", start: null, end: null, current: false },
      ],
    });
    expect(needsRepair(report)).toBe(false);
  });

  it("fires when a stacked header cost the contact block", () => {
    const report = reportWith({
      roles: [
        {
          title: "Engineer",
          employer: "Acme",
          start: { year: 2020, month: 1 },
          end: null,
          current: true,
        },
      ],
    });
    expect(needsRepair(report)).toBe(true);
  });

  it("does not fire on a cleanly parsed resume", () => {
    const report = reportWith({
      name: "Jane",
      email: "j@e.com",
      phone: "555",
      roles: [
        {
          title: "Engineer",
          employer: "Acme",
          start: { year: 2020, month: 1 },
          end: null,
          current: true,
        },
      ],
    });
    expect(needsRepair(report)).toBe(false);
  });
});

describe("grounding: the whitespace-insensitive pass does not open a hole", () => {
  // `isGrounded` compares with whitespace stripped so a word broken across a column still matches;
  // it may join adjacent characters in the document, nothing more.
  it("still rejects a fabricated name after whitespace is stripped", () => {
    expect(isGrounded("Initech", normalizeForGrounding(SOURCE))).toBe(false);
  });

  it("does not let a value match by reordering the document's characters", () => {
    expect(isGrounded("Corporation Acme", normalizeForGrounding(SOURCE))).toBe(false);
  });

  it("does not let a short value slip through as a squashed substring", () => {
    // "ac" would appear inside "acme" once spaces are gone; short values stay word-anchored.
    expect(isGrounded("ac", normalizeForGrounding(SOURCE))).toBe(false);
  });

  it("still rejects an employer built from pieces of two different lines", () => {
    expect(isGrounded("Acme Globex", normalizeForGrounding(SOURCE))).toBe(false);
  });
});

describe("merge: derived fields and provenance follow the merged values", () => {
  it("recomputes tenure and highest degree from repaired rows", () => {
    const { merged } = merge(
      emptyParsed,
      candidate({
        roles: [
          {
            title: "Senior Engineer",
            employer: "Acme Corporation",
            start: { year: 2020, month: 1 },
            end: { year: 2020, month: 12 },
            current: false,
          },
        ],
        education: [
          { school: "University of Somewhere", credential: "BSc Computer Science", end: null },
        ],
      }),
      SOURCE,
    );

    // Derived fields follow the merged values.
    expect(merged.monthsOfExperience).toBe(12);
    expect(merged.highestIsced).toBe(6);
    expect(merged.education[0]!.isced).toBe(6);
  });

  it("stamps filled fields as ai and leaves the rest as they were", () => {
    const deterministic: AtsParsedResume = {
      ...emptyParsed,
      email: "jane.doe@example.com",
      provenance: { ...emptyParsed.provenance, email: "parser" },
    };
    const { merged } = merge(deterministic, candidate({ name: "Jane Q. Doe" }), SOURCE);

    expect(merged.provenance.name).toBe("ai");
    expect(merged.provenance.email).toBe("parser");
    expect(merged.provenance.roles).toBe("none");
  });

  it("drops an implausible date the model returned rather than trusting it", () => {
    const { merged } = merge(
      emptyParsed,
      candidate({
        roles: [
          {
            title: "Senior Engineer",
            employer: "Acme Corporation",
            start: { year: 1066, month: 1 },
            end: null,
            current: false,
          },
        ],
      }),
      SOURCE,
    );
    expect(merged.roles[0]!.start).toBeNull();
  });
});

describe("grounding: a shared source index", () => {
  it("rejects a real employer name hidden inside a longer word", () => {
    const source = normalizeForGrounding(
      "metadata pipelines at Stanford, intelligence, visas, pineapple",
    );
    for (const value of ["Meta", "Ford", "Intel", "Visa", "Apple"])
      expect(isGrounded(value, source), value).toBe(false);
    expect(isGrounded("Stanford", source)).toBe(true);
  });

  it("stays linear in the number of values checked", () => {
    const source = `${"Senior Engineer at Acme Corporation. ".repeat(1_300)}`;
    const candidate = { skills: Array.from({ length: 500 }, (_, i) => `Skill number ${i}`) };
    expectFast(() => findGroundingViolations(candidate, source), 500);
  });

  it("reads an address glued to a run of marks in bounded time", () => {
    const source = `janedoe.dev/${"·".repeat(50_000)}x`;
    expectFast(
      () =>
        expect(findGroundingViolations({ url: "https://janedoe.dev/x" }, source)).toHaveLength(1),
      500,
    );
  });
});

describe("merge: tenure fields are grounded too", () => {
  it("drops a start year that does not appear in the document", () => {
    const { merged } = merge(
      emptyParsed,
      candidate({
        roles: [
          {
            title: "Senior Engineer",
            employer: "Acme Corporation",
            start: { year: 1990, month: 1 },
            end: null,
            current: false,
          },
        ],
      }),
      SOURCE,
    );
    expect(merged.roles[0]!.start).toBeNull();
    expect(merged.monthsOfExperience).toBeNull();
  });

  it("keeps current only when the document says present", () => {
    const role = {
      title: "Senior Engineer",
      employer: "Acme Corporation",
      start: { year: 2020, month: 1 },
      end: null,
      current: true,
    };
    expect(merge(emptyParsed, candidate({ roles: [role] }), SOURCE).merged.roles[0]!.current).toBe(
      true,
    );
    const noPresent = SOURCE.replace("Present", "Dec 2022");
    expect(
      merge(emptyParsed, candidate({ roles: [role] }), noPresent).merged.roles[0]!.current,
    ).toBe(false);
  });

  // "continuing", "ab" and "से" are open ends only where their date ends the line, as the parser
  // reads them: a heading, a company's suffix or a city does not ground `current`.
  const LOCALIZED = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
  const currentIn = (source: string, start: number | null, employer: string) =>
    mergeGrounded(
      emptyParsed,
      candidate({
        roles: [
          {
            title: "Engineer",
            employer,
            start: start === null ? null : { year: start, month: 1 },
            end: null,
            current: true,
          },
        ],
      }),
      source,
      { policy: LOCALIZED, now: NOW },
    ).merged.roles[0]!.current;

  it.each([
    [
      "Experience\nEngineer, Globex Ltd\n2017 - 2019\nContinuing Education\nAWS Solutions Architect course",
      2017,
      "Globex Ltd",
    ],
    [
      "Berufserfahrung\nIngenieur, Volvo AB 2018 – 2021\nEntwicklung von Software für Fahrzeuge und Prüfstände",
      2018,
      "Volvo AB",
    ],
    [
      "अनुभव\nइंजीनियर, Hooli\nजून 2018 - मार्च 2021, दिल्ली से\nटीम का नेतृत्व किया",
      2018,
      "Hooli",
    ],
    ["अनुभव\nइंजीनियर, Hooli दिल्ली से\nटीम का नेतृत्व किया", null, "Hooli"],
  ])("does not keep current from an everyday word in %j", (source, start, employer) => {
    expect(currentIn(source, start, employer)).toBe(false);
  });

  it.each([
    ["Experience\nEngineer, Globex Ltd\nJan 2017 onwards", 2017, "Globex Ltd"],
    ["Experience\nEngineer, Globex Ltd\nJan 2017 - Continuing", 2017, "Globex Ltd"],
    ["Experience\nEngineer, Globex Ltd\nJan 2017 -\nContinuing", 2017, "Globex Ltd"],
    [
      "Berufserfahrung\nIngenieur, Volvo AB\nab 03/2018\nEntwicklung von Software für Fahrzeuge und Prüfstände",
      2018,
      "Volvo AB",
    ],
    ["अनुभव\nइंजीनियर, Hooli\nजून 2018 से\nटीम का नेतृत्व किया", 2018, "Hooli"],
  ])("keeps current where %j says so", (source, start, employer) => {
    expect(currentIn(source, start, employer)).toBe(true);
  });

  it.each([
    ["spaces after a year", `2017${" ".repeat(50_000)}x`],
    ["year and dash run", "2017 - ".repeat(7_000)],
    ["since word and spaces", `2017 ab${" ".repeat(50_000)}x`],
    ["since word and letters", `2017 ab ${"a".repeat(50_000)}`],
  ])("reads a line of %s in linear time", (_, line) => {
    // German, so "ab" is read.
    const source = `Berufserfahrung\nEngineer, Volvo AB\nEntwicklung von Software für Fahrzeuge und Prüfstände\n${line}`;
    expectFast(() => currentIn(source, 2017, "Volvo AB"), 500);
  });

  it("rejects punctuation-only contact values", () => {
    const { merged } = merge(
      emptyParsed,
      candidate({ name: "--", email: "()", phone: "." }),
      SOURCE,
    );
    expect([merged.name, merged.email, merged.phone]).toEqual(["", "", ""]);
  });

  it("is never offered for a structured document", () => {
    const structured = {
      ...emptyParsed,
      provenance: { ...emptyParsed.provenance, name: "structured" as const },
    };
    expect(needsRepair({ parsed: structured, wordCount: 500 })).toBe(false);
  });
});
