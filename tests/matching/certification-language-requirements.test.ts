import { describe, expect, it } from "vitest";

import {
  AtsScoringService,
  DEFAULT_POLICY,
  type AtsRequirement,
  type AtsResumeDocument,
} from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import { expectFast } from "../fixtures/timing.js";

/**
 * A certification asked for is met by a certification row, and a language by a spoken-language
 * row at or above the level asked, with the row as the evidence. Where no row names it, the
 * lines are read as before, so nothing met by them is lost. Invented people only.
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
  AtsScoringService.check(resume, policy, {
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
              expires: "2024-11",
            },
          ],
        },
      ],
    };
    const found = judge(doc, "Kubernetes certification");
    expect(found.status).toBe("met");
    expect(found.evidence[0]).toBe(
      "Certified Kubernetes Administrator, CNCF, Nov 2021, expires Nov 2024",
    );
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
      AtsScoringService.check(resume(level), policy, {
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
