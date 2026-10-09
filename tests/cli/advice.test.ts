import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { main } from "../../src/cli/main.js";

/**
 * The CLI's "Advice" section: what the file and the resume's conventions are worth knowing,
 * printed under its own heading after the failed checks, never in the score. `--ats` adds the
 * documented notes on one applicant tracking system.
 */

const dir = mkdtempSync(join(tmpdir(), "ats-cli-advice-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const RESUME = [
  "Jane Doe",
  "jane.doe@example.com | (415) 555-0199",
  "",
  "Experience",
  "Senior Engineer, Acme Corporation",
  "Jan 2020 - Present",
  "- Built payment systems in TypeScript, cutting failures 40%.",
  "",
  "Education",
  "BSc Computer Science, State University, 2015",
  "",
  "Skills",
  "TypeScript, Go, PostgreSQL",
].join("\n");

function file(name: string, content = RESUME) {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

let out: string[];
let err: string[];

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(console, "log").mockImplementation((line: string) => void out.push(line));
  vi.spyOn(console, "error").mockImplementation((line: string) => void err.push(line));
});

describe("ats-engine check: advice", () => {
  it("prints the advice under its own heading, after the failed checks", async () => {
    expect(await main(["check", file("Resume_final_v3 (2).txt")])).toBe(0);
    const printed = out.join("\n");
    const advice = printed.indexOf("\nAdvice (not scored):");
    expect(advice).toBeGreaterThan(printed.indexOf("Failed checks:"));
    expect(printed.slice(advice)).toContain('"Resume_final_v3 (2).txt"');
    expect(printed.slice(advice)).toContain("Jane-Doe-Resume.txt");
  });

  it("prints no Advice heading when there is none", async () => {
    expect(await main(["check", file("Jane-Doe-Resume.txt")])).toBe(0);
    expect(out.join("\n")).not.toContain("Advice");
  });

  it("adds a target ATS's notes, with their sources, only with --ats", async () => {
    const path = file("Jane-Doe-Resume.txt");
    expect(await main(["check", path, "--ats", "greenhouse"])).toBe(0);
    const printed = out.join("\n");
    expect(printed).toContain("Advice (not scored):");
    expect(printed).toMatch(/Greenhouse/);
    expect(printed).toContain("https://support.greenhouse.io/");

    out = [];
    expect(await main(["check", path])).toBe(0);
    expect(out.join("\n")).not.toContain("greenhouse.io");
  });

  it("includes the advice in --json", async () => {
    expect(await main(["check", file("resume.txt"), "--json", "--ats", "lever"])).toBe(0);
    const report = JSON.parse(out.join("\n"));
    const ids = report.advice.map((item: { id: string }) => item.id);
    expect(ids).toContain("file.name");
    expect(ids.some((id: string) => id.startsWith("ats.lever."))).toBe(true);
  });

  it("refuses an --ats it has no notes on, naming the ones it has", async () => {
    expect(await main(["check", file("Jane-Doe-Resume.txt"), "--ats", "acme"])).toBe(1);
    expect(err.join("\n")).toMatch(/Unknown --ats "acme"; use one of greenhouse, lever, taleo\./);
  });

  it("lists --ats in the help", async () => {
    expect(await main(["check", "--help"])).toBe(0);
    expect(out.join("\n")).toMatch(/--ats <name>/);
  });
});
