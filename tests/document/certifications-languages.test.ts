import { describe, expect, it } from "vitest";

import {
  ATS_DOCUMENT_FORMAT,
  AtsInputError,
  AtsScoringService,
  DEFAULT_POLICY,
  fromJsonResume,
  renderResumeDocument,
  type AtsResumeDocument,
} from "../../src/index.js";

/**
 * Structured input names its certifications and languages in fields, so the parsed record takes
 * them from there (provenance `structured`): a document's own sections, a JSON Resume's
 * `certificates` and `languages`, and an `other` section titled as one. Invented people only.
 */

const NOW = new Date("2026-09-30T00:00:00Z");
const parsed = (input: Parameters<typeof AtsScoringService.check>[0]) =>
  AtsScoringService.check(input, DEFAULT_POLICY, { now: NOW }).parsed;

const DOCUMENT: AtsResumeDocument = {
  format: ATS_DOCUMENT_FORMAT,
  basics: { name: "Jane Doe", email: "jane@example.com" },
  sections: [
    {
      kind: "experience",
      title: "Experience",
      items: [{ title: "Engineer", employer: "Acme Corp", start: "2020-01", current: true }],
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
          url: "https://cncf.example/verify/123",
        },
        { name: "PMP" },
      ],
    },
    {
      kind: "languages",
      title: "Languages",
      items: [
        { language: "English", level: "Native" },
        { language: "German", level: "B2" },
        { language: "Klingon" },
      ],
    },
  ],
};

describe("a document's certifications and languages sections", () => {
  it("fill the parsed rows from their fields", () => {
    const record = parsed(DOCUMENT);
    expect(record.certifications).toEqual([
      {
        name: "Certified Kubernetes Administrator",
        issuer: "CNCF",
        date: { year: 2021, month: 11 },
        expires: { year: 2024, month: 11 },
      },
      { name: "PMP", issuer: "", date: null, expires: null },
    ]);
    // A language field is a language whatever its name; the level is read for its CEFR.
    expect(record.spokenLanguages).toEqual([
      { language: "English", level: "Native", cefr: "C2" },
      { language: "German", level: "B2", cefr: "B2" },
      { language: "Klingon", level: "", cefr: null },
    ]);
    expect(record.provenance).toMatchObject({
      certifications: "structured",
      spokenLanguages: "structured",
    });
  });

  it("render under their titles", () => {
    expect(renderResumeDocument(DOCUMENT).split("\n").slice(-6)).toEqual([
      "Certifications",
      "Certified Kubernetes Administrator, CNCF, 2021-11 - 2024-11",
      "PMP",
      "",
      "Languages",
      "English (Native), German (B2), Klingon",
    ]);
  });

  it("are validated", () => {
    const bad = {
      ...DOCUMENT,
      sections: [{ kind: "languages", title: "Languages", items: [{ level: "C1" }] }],
    };
    expect(() => AtsScoringService.check(bad, DEFAULT_POLICY, { now: NOW })).toThrow(AtsInputError);
  });

  it("are read from an other section titled as one", () => {
    const record = parsed({
      ...DOCUMENT,
      sections: [
        {
          kind: "other",
          title: "Licenses & Certifications",
          items: [{ heading: "PMP (PMI), expires 2027", lines: ["Renewed every three years"] }],
        },
        {
          kind: "other",
          title: "Languages",
          items: [{ lines: ["English (native), Hindi (fluent)"] }],
        },
      ],
    });
    expect(record.certifications).toEqual([
      { name: "PMP", issuer: "PMI", date: null, expires: { year: 2027, month: null } },
    ]);
    expect(record.spokenLanguages.map((row) => [row.language, row.cefr])).toEqual([
      ["English", "C2"],
      ["Hindi", "C1"],
    ]);
  });
});

describe("JSON Resume certificates and languages", () => {
  const json = {
    basics: { name: "Richard Hendriks", email: "richard@piedpiper.example" },
    work: [{ name: "Pied Piper", position: "CEO/President", startDate: "2013-12-01" }],
    certificates: [
      {
        name: "Certified Kubernetes Administrator",
        issuer: "CNCF",
        date: "2021-11-07",
        url: "https://cncf.example/cka",
      },
    ],
    languages: [
      { language: "English", fluency: "Native speaker" },
      { language: "Spanish", fluency: "Conversational" },
    ],
  };

  it("map to the document's own sections", () => {
    const doc = fromJsonResume(json);
    expect(doc.sections.filter((s) => s.kind === "certifications")).toEqual([
      {
        kind: "certifications",
        title: "Certifications",
        items: [
          {
            name: "Certified Kubernetes Administrator",
            issuer: "CNCF",
            date: "2021-11",
            url: "https://cncf.example/cka",
          },
        ],
      },
    ]);
    expect(doc.sections.filter((s) => s.kind === "languages")).toEqual([
      {
        kind: "languages",
        title: "Languages",
        items: [
          { language: "English", level: "Native speaker" },
          { language: "Spanish", level: "Conversational" },
        ],
      },
    ]);
  });

  it("fill the parsed rows", () => {
    const record = parsed(fromJsonResume(json));
    expect(record.certifications).toEqual([
      {
        name: "Certified Kubernetes Administrator",
        issuer: "CNCF",
        date: { year: 2021, month: 11 },
        expires: null,
      },
    ]);
    expect(record.spokenLanguages).toEqual([
      { language: "English", level: "Native speaker", cefr: "C2" },
      { language: "Spanish", level: "Conversational", cefr: "B1" },
    ]);
  });
});
