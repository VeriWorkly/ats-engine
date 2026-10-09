import { describe, expect, it } from "vitest";

import {
  AtsPolicyError,
  AtsScoringService,
  DEFAULT_POLICY,
  parseAtsPolicy,
  type AtsReport,
} from "../../src/index.js";

/**
 * Notes on a named applicant tracking system: only what its vendor documents publicly, each note
 * with the page that says so, and only when the caller names the system. The engine does not
 * simulate any vendor's parser, and says nothing about one it was not asked about.
 */

const NOW = new Date("2026-10-01T00:00:00Z");
const RESUME = `Jane Doe
jane.doe@example.com | (415) 555-0199
Experience
Senior Engineer, Acme Corporation    Jan 2020 – Present
• Built payment systems in TypeScript, cutting failures by 40%
Education
BSc Computer Science, State University, 2015
Skills
TypeScript, Go, PostgreSQL`;

const check = (targetAts?: string): AtsReport =>
  AtsScoringService.check(RESUME, DEFAULT_POLICY, { now: NOW, targetAts });
const notes = (report: AtsReport) => report.advice.filter((item) => item.kind === "ats");

describe("target ATS notes", () => {
  it("gives none unless a target is named", () => {
    expect(notes(check())).toEqual([]);
  });

  it.each(Object.keys(DEFAULT_POLICY.advice.targets))(
    "gives %s's documented notes, each with its public source",
    (target) => {
      const given = notes(check(target));
      expect(given.length).toBeGreaterThan(0);
      for (const note of given) {
        expect(note.id.startsWith(`ats.${target}.`)).toBe(true);
        expect(note.source).toMatch(/^https:\/\/\S+$/);
        expect(note.message.length).toBeGreaterThan(20);
      }
      // Only the named system's notes.
      expect(notes(check(target)).every((note) => note.id.startsWith(`ats.${target}.`))).toBe(true);
    },
  );

  it("keeps the list small and sourced from the vendor's own pages", () => {
    const sources = Object.values(DEFAULT_POLICY.advice.targets).flatMap((target) =>
      target.notes.map((note) => new URL(note.source).hostname),
    );
    expect(sources.length).toBeLessThanOrEqual(8);
    for (const host of sources)
      expect(host).toMatch(/(?:^|\.)(?:greenhouse\.io|lever\.co|oracle\.com)$/);
  });

  it("matches the name case-insensitively", () => {
    expect(notes(check("Greenhouse")).length).toBe(notes(check("greenhouse")).length);
  });

  it("refuses a system the policy has no notes on, naming the ones it has", () => {
    expect(() => check("acme-ats")).toThrow(AtsPolicyError);
    expect(() => check("acme-ats")).toThrow(/greenhouse/);
  });

  it("refuses a note without an https source in a policy", () => {
    expect(() =>
      parseAtsPolicy({
        ...DEFAULT_POLICY,
        advice: {
          ...DEFAULT_POLICY.advice,
          targets: {
            acme: { name: "Acme", notes: [{ id: "x", message: "m", source: "ftp://x" }] },
          },
        },
      }),
    ).toThrow(AtsPolicyError);
  });
});
