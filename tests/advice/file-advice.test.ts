import { describe, expect, it } from "vitest";

import {
  AtsScoringService,
  DEFAULT_POLICY,
  type AtsCheckOptions,
  type AtsReport,
} from "../../src/index.js";
import { expectFast } from "../fixtures/timing.js";

/**
 * File hygiene: what the file itself says before anyone reads it — its name, its size, a
 * password, tracked changes and comments left in. Advice, not scored, and only when the caller
 * says what the file was: pasted text has no file to judge.
 */

const NOW = new Date("2026-10-01T00:00:00Z");
const RESUME = `Jane Doe
jane.doe@example.com | (415) 555-0199
Experience
Senior Engineer, Acme Corporation    Jan 2020 – Present
• Built payment systems in TypeScript, cutting failures by 40%
• Led a team of 5 engineers through the move to Kubernetes
Education
BSc Computer Science, State University, 2015
Skills
TypeScript, Go, PostgreSQL`;

const check = (options: AtsCheckOptions = {}, resume = RESUME): AtsReport =>
  AtsScoringService.check(resume, DEFAULT_POLICY, { now: NOW, ...options });
const advice = (report: AtsReport, id: string) => report.advice.find((item) => item.id === id);
const named = (name: string, resume?: string) => check({ file: { name } }, resume);

describe("advice is always present", () => {
  it("is an empty list for pasted text with nothing to advise", () => {
    expect(check().advice).toEqual([]);
  });
});

describe("file name", () => {
  it.each([
    ["Resume_final_v3 (2).pdf", ["final", "v3", "(2)"]],
    ["resume.pdf", []],
    ["CV.docx", []],
    ["Document1.docx", []],
    ["scan0001.pdf", []],
    ["My Resume - Copy.docx", ["Copy"]],
    ["IMG_2041.pdf", []],
    ["Jane_Doe_Resume_FINAL.pdf", ["FINAL"]],
    ["resume(1).pdf", ["(1)"]],
  ])("flags %s", (name, marks) => {
    const item = advice(named(name), "file.name");
    expect(item).toMatchObject({ kind: "file" });
    expect(item!.evidence).toContain(`"${name}"`);
    for (const mark of marks) expect(item!.evidence).toContain(`"${mark}"`);
    // The suggestion uses the name the parser read, and keeps the file's extension.
    expect(item!.fix).toContain(`Jane-Doe-Resume${name.slice(name.lastIndexOf("."))}`);
  });

  it.each([
    "Jane-Doe-Resume.pdf",
    "Jane Doe CV.docx",
    "doe_jane_2026.pdf",
    "José_Núñez_CV.pdf",
    "Müller-Lebenslauf.pdf",
    "Lebenslauf.pdf",
    "Анна-Иванова-Резюме.pdf",
    "प्रिया-शर्मा-resume.pdf",
    "李伟简历.docx",
    "Jane Doe - Resume.pdf",
  ])("leaves %s alone", (name) => {
    expect(advice(named(name), "file.name")).toBeUndefined();
  });

  it("suggests a placeholder name when the parser read none", () => {
    const item = advice(named("resume.docx", RESUME.replace("Jane Doe\n", "")), "file.name");
    expect(item?.fix).toContain("Firstname-Lastname-Resume.docx");
  });

  it("takes the extension from the format when the name has none", () => {
    const item = advice(check({ file: { name: "resume", format: "pdf" } }), "file.name");
    expect(item?.fix).toContain("Jane-Doe-Resume.pdf");
  });

  it("reads a hostile file name in linear time", () => {
    const hostile = `${"v1 (2) ".repeat(5_000)}${"a_".repeat(20_000)}.pdf`;
    expectFast(() => named(hostile), 1_000, "file name");
  });
});

describe("file size", () => {
  it("advises past the policy's limit, calling it common rather than universal", () => {
    const item = advice(check({ file: { bytes: 3.4 * 1024 * 1024 } }), "file.size");
    expect(item).toMatchObject({ kind: "file", evidence: "The file is 3.4 MB." });
    expect(item!.message).toMatch(/common limit, not a universal one/);
  });

  it("is quiet at or under it", () => {
    expect(advice(check({ file: { bytes: 2 * 1024 * 1024 } }), "file.size")).toBeUndefined();
    expect(advice(check({ file: { bytes: 180_000 } }), "file.size")).toBeUndefined();
  });
});

describe("password protection", () => {
  it("advises when the host says the file is protected", () => {
    expect(
      advice(check({ file: { passwordProtected: true } }), "file.passwordProtected"),
    ).toMatchObject({
      kind: "file",
    });
  });

  it("advises when the extraction found an encrypted PDF that still opened", () => {
    const layout = { columnRatio: 0, tableCount: 0, pageCount: 1, encrypted: true };
    const report = check({ layout, file: { name: "Jane-Doe-Resume.pdf" } });
    expect(advice(report, "file.passwordProtected")).toBeDefined();
    // Once, however many sources say so.
    const both = check({ layout, file: { passwordProtected: true } });
    expect(both.advice.filter((item) => item.id === "file.passwordProtected")).toHaveLength(1);
  });

  it("is quiet otherwise", () => {
    expect(
      advice(check({ file: { passwordProtected: false } }), "file.passwordProtected"),
    ).toBeUndefined();
  });
});

describe("tracked changes and comments", () => {
  const layout = { columnRatio: null, tableCount: 0, pageCount: 0 };

  it("advises with the counts the DOCX measurement found", () => {
    const report = check({ layout: { ...layout, trackedChanges: 3, comments: 1 } });
    expect(advice(report, "file.trackedChanges")).toMatchObject({
      kind: "file",
      evidence: "3 tracked changes in the document.",
    });
    expect(advice(report, "file.comments")).toMatchObject({
      kind: "file",
      evidence: "1 comment in the document.",
    });
  });

  it("advises without a count when only the host says so", () => {
    const report = check({ file: { trackedChanges: true, comments: true } });
    expect(advice(report, "file.trackedChanges")).toBeDefined();
    expect(advice(report, "file.trackedChanges")!.evidence).toBeUndefined();
    expect(advice(report, "file.comments")).toBeDefined();
  });

  it("is quiet for a clean document", () => {
    const report = check({ layout: { ...layout, trackedChanges: 0, comments: 0 } });
    expect(report.advice).toEqual([]);
  });
});
