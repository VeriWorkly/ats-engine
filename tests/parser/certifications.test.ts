import { describe, expect, it } from "vitest";

import { DEFAULT_POLICY, parseResume, check } from "../../src/index.js";
import { BUILT_IN_LOCALES, withLocales } from "../../src/locales/index.js";
import { segmentResume } from "../../src/parser/sections.js";
import { expectFast } from "../fixtures/timing.js";

// Certifications and licences read as rows: name, issuer, date earned, date of expiry.

const NOW = new Date("2026-10-01T00:00:00Z");
const LOCALES = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
const HEAD = "Jane Doe\njane@example.com | +1 415 555 0142";
const JOB = "Experience\nSoftware Engineer, Acme Corp Jan 2019 - Present\n- Built payment services";

const parse = (body: string, policy = DEFAULT_POLICY) =>
  parseResume(`${HEAD}\n${JOB}\n${body}`.split("\n"), policy, NOW);
const certs = (lines: string, heading = "Certifications") =>
  parse(`${heading}\n${lines}`).certifications;

describe("a certifications heading opens a section of its own", () => {
  it.each([
    "Certifications",
    "Certificates",
    "Licenses and Certifications",
    "Licenses & Certifications",
    "Licensure",
    "Professional Certifications",
  ])("%s", (heading) => {
    const kinds = segmentResume([heading, "PMP"], DEFAULT_POLICY).map((s) => s.kind);
    expect(kinds).toEqual(["certifications"]);
  });

  it("keeps Education and Certifications an education section", () => {
    const kinds = segmentResume(["Education and Certifications", "MIT"], DEFAULT_POLICY);
    expect(kinds.map((s) => s.kind)).toEqual(["education"]);
  });

  it.each([
    ["Zertifikate", "de"],
    ["Zertifizierungen", "de"],
    ["प्रमाणपत्र", "hi"],
  ])("%s in the %s pack", (heading, language) => {
    const report = check(`${heading}\nPMP`, LOCALES, {
      languages: [language],
      now: NOW,
    });
    expect(report.parsed.certifications.map((row) => row.name)).toEqual(["PMP"]);
  });
});

describe("a certification line becomes a row", () => {
  it("reads name, issuer and year", () => {
    expect(
      certs("AWS Certified Solutions Architect – Associate, Amazon Web Services, 2023"),
    ).toEqual([
      {
        name: "AWS Certified Solutions Architect – Associate",
        issuer: "Amazon Web Services",
        date: { year: 2023, month: null },
        expires: null,
      },
    ]);
  });

  it("reads the issuer in brackets and an expiry", () => {
    expect(certs("PMP (PMI), expires 2027")).toEqual([
      { name: "PMP", issuer: "PMI", date: null, expires: { year: 2027, month: null } },
    ]);
  });

  it("reads LinkedIn's issued and expires labels between bars and dots", () => {
    expect(
      certs(
        "Certified Kubernetes Administrator (CKA) | The Linux Foundation | Issued Mar 2022 · Expires Mar 2025",
      ),
    ).toEqual([
      {
        name: "Certified Kubernetes Administrator (CKA)",
        issuer: "The Linux Foundation",
        date: { year: 2022, month: 3 },
        expires: { year: 2025, month: 3 },
      },
    ]);
  });

  it("reads a range as earned and expiring", () => {
    expect(certs("• Certified ScrumMaster, Scrum Alliance (2019 - 2023)")).toEqual([
      {
        name: "Certified ScrumMaster",
        issuer: "Scrum Alliance",
        date: { year: 2019, month: null },
        expires: { year: 2023, month: null },
      },
    ]);
  });

  it("reads an issuer after 'from'", () => {
    expect(certs("Google Professional Data Engineer from Google Cloud, 2021")[0]).toMatchObject({
      name: "Google Professional Data Engineer",
      issuer: "Google Cloud",
    });
  });

  it("reads columns set apart by wide gaps", () => {
    expect(
      certs(
        "Registered Nurse, State Board of Nursing    2018 - 2026\nBLS Certification, American Heart Association    2024 - 2026",
        "Licenses and Certifications",
      ),
    ).toEqual([
      {
        name: "Registered Nurse",
        issuer: "State Board of Nursing",
        date: { year: 2018, month: null },
        expires: { year: 2026, month: null },
      },
      {
        name: "BLS Certification",
        issuer: "American Heart Association",
        date: { year: 2024, month: null },
        expires: { year: 2026, month: null },
      },
    ]);
  });

  it("splits on spaced dashes only when there are two of them", () => {
    expect(certs("ITIL 4 Foundation – AXELOS – 2020")[0]).toMatchObject({
      name: "ITIL 4 Foundation",
      issuer: "AXELOS",
      date: { year: 2020, month: null },
    });
    expect(certs("AWS Certified Developer – Associate (2021)")[0]).toMatchObject({
      name: "AWS Certified Developer – Associate",
      issuer: "",
      date: { year: 2021, month: null },
    });
  });

  it("joins a line of dates alone to the certification above it", () => {
    expect(
      certs("AWS Certified Developer – Associate\nIssued Jan 2021 · Expires Jan 2024\nPMP"),
    ).toEqual([
      {
        name: "AWS Certified Developer – Associate",
        issuer: "",
        date: { year: 2021, month: 1 },
        expires: { year: 2024, month: 1 },
      },
      { name: "PMP", issuer: "", date: null, expires: null },
    ]);
  });

  // A renewal listed as a second row with the same name collapsed onto the first, lapsed one.
  it.each([
    "CISSP, ISC2, 2015, expired 2021\nCISSP, ISC2, 2023, expires 2029",
    "CISSP, ISC2, 2023, expires 2029\nCISSP, ISC2, 2015, expired 2021",
  ])("keeps the latest row of a certification listed twice: %s", (lines) => {
    expect(certs(lines)).toEqual([
      {
        name: "CISSP",
        issuer: "ISC2",
        date: { year: 2023, month: null },
        expires: { year: 2029, month: null },
      },
    ]);
  });

  it("reads a renewal after an expiry as the date earned", () => {
    expect(certs("CISSP, ISC2, 2019, expired 2021, renewed 2023")).toEqual([
      { name: "CISSP", issuer: "ISC2", date: { year: 2023, month: null }, expires: null },
    ]);
    expect(certs("PMP (PMI), issued 2016, renewed 2022, expires 2028")).toEqual([
      {
        name: "PMP",
        issuer: "PMI",
        date: { year: 2022, month: null },
        expires: { year: 2028, month: null },
      },
    ]);
  });

  // The second date was taken as the expiry, and brackets emptied of dates stayed in the name.
  it("reads the last of several ranges as the expiry, and drops emptied brackets", () => {
    expect(certs("CISSP, ISC2, 2015–2018, 2021–2027")[0]).toMatchObject({
      date: { year: 2015, month: null },
      expires: { year: 2027, month: null },
    });
    expect(
      certs("AWS Certified Developer – Associate (2019, renewed 2022; expires 2028)")[0],
    ).toMatchObject({ name: "AWS Certified Developer – Associate", issuer: "" });
    expect(certs("CKA (2021; renewed 2024)")[0]).toMatchObject({
      name: "CKA",
      date: { year: 2024, month: null },
    });
    expect(certs("AWS Certified Data Analytics – Specialty (2022, expires 2025)")[0]?.name).toBe(
      "AWS Certified Data Analytics – Specialty",
    );
  });

  it("keeps a year that is part of the name", () => {
    expect(certs("Windows Server 2019 Administrator\nMar 2022 Expires Mar 2025 CKA")).toEqual([
      { name: "Windows Server 2019 Administrator", issuer: "", date: null, expires: null },
      {
        name: "CKA",
        issuer: "",
        date: { year: 2022, month: 3 },
        expires: { year: 2025, month: 3 },
      },
    ]);
  });

  it("drops a credential id", () => {
    expect(
      certs("Microsoft Certified: Azure Fundamentals, Microsoft, 2022, Credential ID 9X7Y2Z"),
    ).toEqual([
      {
        name: "Microsoft Certified: Azure Fundamentals",
        issuer: "Microsoft",
        date: { year: 2022, month: null },
        expires: null,
      },
    ]);
  });

  it("does not read a certification as a job", () => {
    const parsed = parse("Certifications\nCertified Scrum Master — 2019 - 2023");
    expect(parsed.roles).toHaveLength(1);
    expect(parsed.certifications).toEqual([
      {
        name: "Certified Scrum Master",
        issuer: "",
        date: { year: 2019, month: null },
        expires: { year: 2023, month: null },
      },
    ]);
  });

  it("reads a labelled line in the skills", () => {
    const parsed = parse("Skills\nGo, Python\nCertifications: AWS Certified Developer (2021), PMP");
    expect(parsed.certifications.map((row) => row.name)).toEqual([
      "AWS Certified Developer",
      "PMP",
    ]);
    expect(parsed.certifications[0]?.date).toEqual({ year: 2021, month: null });
    expect(parsed.skills).toEqual(["Go", "Python"]);
  });

  it("stamps provenance", () => {
    expect(parse("Certifications\nPMP").provenance.certifications).toBe("parser");
    expect(parse("").provenance.certifications).toBe("none");
  });
});

describe("certifications in German and Hindi", () => {
  const read = (text: string, language: string) =>
    check(text, LOCALES, { languages: [language], now: NOW }).parsed.certifications;

  it("reads a German expiry and a month-first date", () => {
    expect(
      read(
        `${HEAD}\nZertifikate\nAWS Certified Cloud Practitioner, Amazon Web Services, 05/2022\nProfessional Scrum Master (PSM I), Scrum.org, gültig bis 12/2027`,
        "de",
      ),
    ).toEqual([
      {
        name: "AWS Certified Cloud Practitioner",
        issuer: "Amazon Web Services",
        date: { year: 2022, month: 5 },
        expires: null,
      },
      {
        name: "Professional Scrum Master (PSM I)",
        issuer: "Scrum.org",
        date: null,
        expires: { year: 2027, month: 12 },
      },
    ]);
  });

  it("reads a Hindi expiry", () => {
    expect(read(`${HEAD}\nप्रमाणपत्र\nपीएमपी (पीएमआई), समाप्ति 2027`, "hi")).toEqual([
      { name: "पीएमपी", issuer: "पीएमआई", date: null, expires: { year: 2027, month: null } },
    ]);
  });
});

describe("certification lines stay linear", () => {
  const N = 40_000;
  const rep = (unit: string) => unit.repeat(Math.ceil(N / unit.length)).slice(0, N);
  it.each([
    rep("expires "),
    rep("Issued Jan 2021 · "),
    rep("a, "),
    rep("a – "),
    rep("(a"),
    rep("from "),
    rep("credential id "),
    rep("2019 - "),
    rep("(, ; "),
    `${rep(" ")}x`,
  ])("hostile certification line %#", (line) => {
    expectFast(() => parse(`Certifications\n${line}\nSkills\nCertifications: ${line}`), 1_500);
  });
});
