import { describe, expect, it } from "vitest";

import {
  DEFAULT_POLICY,
  type AtsRequirement,
  type AtsResumeDocument,
  check,
} from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import { expectFast } from "../fixtures/timing.js";

/**
 * A certification asked for is met by a certification row, and a language by a spoken-language
 * row at or above the level asked, with the row as the evidence. Without a row, lines are read.
 */

const NOW = new Date("2026-10-01T00:00:00Z");
const BASE = `Jane Doe
jane@example.com | +1 415 555 0142
Experience
Cloud Engineer, Acme Corp Jan 2019 - Present
- Ran payment services on AWS and Kubernetes for 2M users
Education
B.S. Computer Science, State University 2015
Skills
Go, Python, AWS, Kubernetes`;

const judge = (resume: string | AtsResumeDocument, ask: string, policy = DEFAULT_POLICY) =>
  check(resume, policy, {
    jobDescription: `Requirements\n- ${ask}`,
    now: NOW,
  }).requirements[0] as AtsRequirement;

describe("a certification asked for", () => {
  const certified = `${BASE}\nLicenses & Certifications\nAWS Certified Solutions Architect – Associate, Amazon Web Services, 2023\nPMP (PMI), expires 2027`;

  it("is met by a certification row, which is the evidence", () => {
    const found = judge(certified, "AWS certification");
    expect(found.status).toBe("met");
    expect(found.evidence[0]).toBe(
      "AWS Certified Solutions Architect – Associate, Amazon Web Services, 2023",
    );
  });

  it("is met by a row under a heading that names no credential", () => {
    const resume = `${BASE}\nLicenses\nPMP (PMI), expires 2027`;
    const found = judge(resume, "PMP certification required");
    expect(found.status).toBe("met");
    expect(found.evidence[0]).toBe("PMP, PMI, expires 2027");
  });

  it("is partial when the resume names the skill but holds no certification in it", () => {
    const found = judge(BASE, "AWS certification");
    expect(found.status).toBe("partial");
    expect(found.terms).toContainEqual({ term: "certification", found: false });
  });

  it("is missing when nothing names it", () => {
    const found = judge(certified, "CISSP certification");
    expect(found.status).toBe("missing");
  });

  it("is met by a row of a structured document", () => {
    const doc: AtsResumeDocument = {
      format: "ats-resume@1",
      basics: { name: "Jane Doe", email: "jane@example.com" },
      sections: [
        {
          kind: "experience",
          title: "Experience",
          items: [
            {
              title: "Cloud Engineer",
              employer: "Acme Corp",
              start: "2019-01",
              current: true,
              highlights: ["Ran services on Kubernetes"],
            },
          ],
        },
        {
          kind: "certifications",
          title: "Certifications",
          items: [
            {
              name: "Certified Kubernetes Administrator",
              issuer: "CNCF",
              date: "2021-11",
              expires: "2027-11",
            },
          ],
        },
      ],
    };
    const found = judge(doc, "Kubernetes certification");
    expect(found.status).toBe("met");
    expect(found.evidence[0]).toBe(
      "Certified Kubernetes Administrator, CNCF, Nov 2021, expires Nov 2027",
    );
  });
});

// An expired or unfinished certification met the ask as a held one did.
describe("a certification not held", () => {
  const listing = (row: string) => `${BASE}\nCertifications\n${row}`;

  it.each([
    ["CISSP, ISC2, 2015, expired 2021", "Active CISSP certification", "CISSP: expired 2021"],
    ["CISSP (expired 2021)", "CISSP certification required", "CISSP: expired 2021"],
    [
      "CISSP (in progress, expected Dec 2026)",
      "CISSP certification required",
      "CISSP: not yet held",
    ],
    ["CISSP, expected Dec 2026", "CISSP certification required", "CISSP: not yet held"],
    [
      "AWS Certified Solutions Architect (in progress)",
      "AWS certification required",
      "AWS Certified Solutions Architect: not yet held",
    ],
    // Without a credential word in the ask, a lapsed row met it.
    ["CISSP (expired 2021)", "Active CISSP", "CISSP: expired 2021"],
    ["CISSP (expired 2021)", "CISSP required", "CISSP: expired 2021"],
    ["CISSP (expired 2021)", "Must hold a current CISSP", "CISSP: expired 2021"],
    ["CISSP (in progress)", "CISSP required", "CISSP: not yet held"],
  ])("is partial, and says why: %s for %s", (row, ask, detail) => {
    const found = judge(listing(row), ask);
    expect(found).toMatchObject({ status: "partial", detail });
    expect(found.evidence[0]).toMatch(/^(?:CISSP|AWS Certified Solutions Architect)/);
  });

  // Rows with one name collapsed onto the first: a renewal listed below a lapsed row was partial.
  it.each([
    "AWS Certified Developer, Amazon Web Services, 2015, expired 2018\nAWS Certified Solutions Architect, Amazon Web Services, 2023, expires 2029",
    "AWS Certified Solutions Architect, Amazon Web Services, 2015, expired 2018\nAWS Certified Solutions Architect, Amazon Web Services, 2023, expires 2029",
  ])("is met by a held row beside a lapsed one: %s", (rows) => {
    const found = judge(listing(rows), "AWS certification required");
    expect(found.status).toBe("met");
    expect(found.detail).toBeUndefined();
    expect(found.evidence[0]).toBe(
      "AWS Certified Solutions Architect, Amazon Web Services, 2023, expires 2029",
    );
  });

  it.each([
    "CISSP, ISC2, 2015, expired 2021\nCISSP, ISC2, 2023, expires 2029",
    "CISSP (ISC2), 2019, expired 2021, renewed 2023",
  ])("is met by a renewal: %s", (rows) => {
    const found = judge(listing(rows), "CISSP certification required");
    expect(found.status).toBe("met");
    expect(found.detail).toBeUndefined();
  });

  it("still meets a skill the work history shows beside an unfinished certification in it", () => {
    const resume = listing("AWS Certified Solutions Architect (in progress)");
    expect(judge(resume, "Experience with AWS").status).toBe("met");
    expect(judge(`${resume}\nCISM, ISACA, 2020`, "CISSP or CISM").status).toBe("met");
  });

  // An in-progress word anywhere in the name counted, a label's too.
  it("reads an in-progress word in a label only when it ends the label", () => {
    const ask = "CISSP certification required";
    expect(judge(listing("Pursuing excellence: CISSP, ISC2, 2019"), ask).status).toBe("met");
    expect(judge(listing("Currently pursuing: CISSP"), ask)).toMatchObject({
      status: "partial",
      detail: "Currently pursuing: CISSP: not yet held",
    });
    expect(judge(listing("Pursuing CISSP"), ask).status).toBe("partial");
  });

  it("stays fast with many lapsed rows", () => {
    const rows = Array.from({ length: 2_000 }, (_, i) => `Cert ${i} AWS (expired 2020)`).join("\n");
    const bullets = Array.from({ length: 1_000 }, (_, i) => `- Ran AWS service ${i}`).join("\n");
    const resume = `${BASE}\n${bullets}\nCertifications\n${rows}`;
    expectFast(() => judge(resume, "AWS required"), 1_500);
  });

  it("is met by a row with no expiry", () => {
    expect(judge(listing("CISSP, ISC2, 2019"), "Active CISSP certification").status).toBe("met");
  });

  it("is met by a row whose words say no more than that it needs no renewal", () => {
    expect(
      judge(listing("CISSP, ISC2 (no longer required to renew)"), "CISSP certification").status,
    ).toBe("met");
  });

  // An unlabelled second date was read as an expiry, and in-progress words of the next item in a
  // one-line list as the row's own: each was partial.
  it.each([
    [
      "Google Data Analytics Professional Certificate, Coursera, 2021 – 2022",
      "Google Data Analytics Certificate",
    ],
    [
      "Google Data Analytics Professional Certificate, Coursera, 2021 – 2022",
      "Data analytics certification preferred",
    ],
    ["Six Sigma Green Belt, ASQ, 2018 – 2019", "Six Sigma"],
    [
      "Certificate in Project Management, UC Berkeley Extension, 2019 – 2020",
      "Project management certificate",
    ],
    ["Tableau Desktop Specialist (2022–2023)", "Tableau certification"],
    ["CISSP, ISC2, 2015–2018, 2021–2027", "CISSP certification required"],
    ["PMP (2019), CSM (2020), Six Sigma Green Belt (in progress)", "PMP certification required"],
    ["PMP (2019), Six Sigma Green Belt (in progress)", "PMP certification required"],
    ["PMP · Six Sigma Green Belt (in progress)", "PMP certification required"],
    [
      "Microsoft Certified: Azure Fundamentals (AZ-900) - working towards AZ-104",
      "Azure certification required",
    ],
    ["PMP (PMI, 2019; renewal in progress)", "PMP certification required"],
    ["Six Sigma Green Belt (in progress), PMP, 2019", "PMP certification required"],
    ["PMP, 2019, Six Sigma Green Belt (in progress)", "PMP certification required"],
  ])("is met by a row with a range, in a list, or being renewed: %s for %s", (row, ask) => {
    const found = judge(listing(row), ask);
    expect(found.status).toBe("met");
    expect(found.detail).toBeUndefined();
  });

  // The next item of a one-line list took the in-progress word of the item before it.
  it("keeps an in-progress item of a one-line list not held, and only it", () => {
    const row = listing("Six Sigma Green Belt (in progress), PMP, 2019");
    expect(judge(row, "Six Sigma Green Belt certification")).toMatchObject({
      status: "partial",
      detail: "Six Sigma Green Belt (in progress): not yet held",
    });
    const issued = listing("AWS Certified Developer (in progress), Amazon Web Services");
    expect(judge(issued, "AWS certification required").status).toBe("partial");
  });

  it("still reads an in-progress word at the end of the row, or opening it", () => {
    const ask = "CISSP certification required";
    for (const row of ["CISSP – in progress", "CISSP, currently pursuing", "Studying for CISSP"])
      expect(judge(listing(row), ask).status, row).toBe("partial");
  });

  // A line naming an expired row's name lost the skill: "Kubernetes" in the skills and a role.
  it("still meets a skill the work history shows beside an expired row named like it", () => {
    const resume = listing("Kubernetes, CNCF, 2019, expired 2022");
    expect(judge(resume, "Kubernetes experience").status).toBe("met");
    expect(judge(resume, "5+ years of Kubernetes experience").status).toBe("met");
    const scrum = `${BASE.replace("Experience\n", "Experience\nScrum Master, Globex Jan 2016 - Dec 2018\n- Coached 3 teams\n")}\nCertifications\nScrum Master, Scrum Alliance, 2016, expired 2018`;
    expect(judge(scrum, "Experience as a Scrum Master").status).toBe("met");
    // A "Certifications:" line among the skills is a row, not the work history.
    const labelled = `${BASE}\nCertifications: CISSP (expired 2021)`;
    expect(judge(labelled, "CISSP required")).toMatchObject({
      status: "partial",
      detail: "CISSP: expired 2021",
    });
  });

  it("says nothing of an expired row that does not name the skill asked", () => {
    const found = judge(
      listing("Kubernetes, CNCF, 2019, expired 2022"),
      "Azure certification required",
    );
    expect(found.status).toBe("missing");
    expect(found.detail).toBeUndefined();
  });
});

describe("a language asked for", () => {
  const speaks = (languages: string) => `${BASE}\nLanguages\n${languages}`;

  it("is met by a row at the level asked, which is the evidence", () => {
    const found = judge(speaks("English (native), German (C1)"), "Fluent German");
    expect(found).toMatchObject({ kind: "language", status: "met", evidence: ["German (C1)"] });
  });

  it("is met by a row above the level asked", () => {
    expect(judge(speaks("German (native)"), "German (B2) or better").status).toBe("met");
  });

  it("is partial by a row below the level asked, and says so", () => {
    const found = judge(speaks("English (native), German (B2)"), "Fluent German");
    expect(found.status).toBe("partial");
    expect(found.evidence).toEqual(["German (B2)"]);
    expect(found.detail).toBe("German: B2 read, C1 asked");
  });

  it("is missing by a beginner's row when fluency is asked", () => {
    expect(judge(speaks("Spanish (beginner)"), "Fluent in Spanish").status).toBe("missing");
  });

  it("is met by any row when no level is asked", () => {
    expect(judge(speaks("German (A2)"), "Must speak German").status).toBe("met");
  });

  it("is met by a row with no level", () => {
    expect(judge(speaks("English, German"), "Fluent German").status).toBe("met");
  });

  // A level it cannot read is no worse than no level: "excellent" or "heritage speaker" is honest.
  it("is met by a row whose level it cannot read, as by a row with none", () => {
    for (const row of ["Spanish (excellent)", "Spanish (heritage speaker)", "Spanish (5/5)"])
      expect(judge(speaks(row), "Fluent Spanish").status, row).toBe("met");
  });

  it.each([
    ["Spanish (currently learning)", "Fluent Spanish", "en"],
    ["Spanish (school level)", "Fluent Spanish", "en"],
    ["Französisch (Schulkenntnisse)", "Verhandlungssicheres Französisch", "de"],
  ])("reads a learner's level: %s", (row, ask, language) => {
    const found = check(speaks(row), withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES), {
      jobDescription: `Requirements\n- ${ask}`,
      languages: [language],
      now: NOW,
    }).requirements[0] as AtsRequirement;
    expect(found).toMatchObject({ kind: "language", status: "missing" });
  });

  it("is missing when the rows leave it off", () => {
    const found = judge(speaks("English (native), German (C1)"), "Fluent French");
    expect(found.status).toBe("missing");
    expect(found.evidence).toEqual([]);
  });

  it("weighs each language asked at its own level", () => {
    const found = judge(speaks("English (native), Spanish (A2)"), "Fluent English, basic Spanish");
    expect(found.status).toBe("met");
  });

  it("still finds a language named only in a bullet, as before", () => {
    const resume = `${BASE.replace("for 2M users", "for 2M users\n- Negotiated contracts in Spanish with suppliers")}`;
    expect(judge(resume, "Fluent in Spanish").status).toBe("met");
  });

  it("reads a German posting's level against a German resume's rows", () => {
    const policy = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
    const resume = (level: string) =>
      `Anna Schmidt\nanna@example.de\nBerufserfahrung\nBeraterin bei Beispiel GmbH seit 04/2021\n• Leitung von Projekten\nSprachen\nDeutsch (Muttersprache), Englisch (${level})`;
    const ask = (level: string) =>
      check(resume(level), policy, {
        jobDescription: "Ihr Profil\n- Verhandlungssichere Englischkenntnisse",
        now: NOW,
        languages: ["de"],
      }).requirements[0];
    expect(ask("fließend")).toMatchObject({ kind: "language", status: "met" });
    expect(ask("Grundkenntnisse")?.status).toBe("missing");
  });

  it("is met by a row of a structured document", () => {
    const doc: AtsResumeDocument = {
      format: "ats-resume@1",
      basics: { name: "Jane Doe", email: "jane@example.com" },
      sections: [
        { kind: "languages", title: "Languages", items: [{ language: "German", level: "C1" }] },
      ],
    };
    expect(judge(doc, "Fluent German")).toMatchObject({ status: "met", evidence: ["German (C1)"] });
  });

  it("stays linear on hostile asks", () => {
    const N = 40_000;
    for (const unit of ["fluent German ", "B2 ", "German (", "native "]) {
      const ask = unit.repeat(Math.ceil(N / unit.length)).slice(0, N);
      expectFast(() => judge(speaks("German (B2)"), ask), 2_000);
    }
  });
});
