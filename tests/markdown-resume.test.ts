import { describe, expect, it } from "vitest";

import { check, DEFAULT_POLICY, parseResume } from "../src/index.js";
import { expectFast } from "./fixtures/timing.js";

/**
 * A resume written in Markdown, as `.md` files and resumes drafted in an editor or by an
 * assistant are: its heading marks, emphasis and link syntax are read past, not as text.
 */

const MARKDOWN = [
  "# Priya Raman",
  "",
  "priya.raman@example.com | (415) 555-0142 | [LinkedIn](https://linkedin.com/in/priya-raman-example)",
  "",
  "## Experience",
  "",
  "**Senior Software Engineer**, Northwind Payments, San Francisco, CA",
  "Mar 2021 – Present",
  "",
  "- Led the move of settlement services to Kubernetes, cutting deploy time from 40 to 6 minutes.",
  "- Designed an idempotent ledger API in **TypeScript** handling 12 million transactions a day.",
  "",
  "---",
  "",
  "### Software Engineer, Contoso Analytics, Oakland, CA",
  "Jun 2018 – Feb 2021",
  "",
  "* Built Kafka pipelines in Go that load 3 TB a day into PostgreSQL.",
  "",
  "## Education",
  "",
  "B.S. Computer Science, University of California, Davis, 2018",
  "",
  "## Skills",
  "",
  "TypeScript, Go, PostgreSQL, Kafka, Kubernetes",
];

const now = new Date("2026-10-01T00:00:00Z");

describe("a Markdown resume", () => {
  const parsed = parseResume(MARKDOWN, DEFAULT_POLICY, now);

  it("reads the name from a level-one heading", () => {
    expect(parsed.name).toBe("Priya Raman");
  });

  it("finds the sections under ## headings and the roles under them", () => {
    expect(parsed.roles.map((role) => [role.title, role.employer])).toEqual([
      ["Senior Software Engineer", "Northwind Payments"],
      ["Software Engineer", "Contoso Analytics"],
    ]);
    expect(parsed.education).toHaveLength(1);
    expect(parsed.skills).toContain("Kubernetes");
  });

  it("reads a link's target", () => {
    expect(parsed.links.join(" ")).toContain("linkedin.com/in/priya-raman-example");
  });

  it("scores as the same resume without the syntax does", () => {
    const plain = MARKDOWN.map((line) =>
      line
        .replace(/^#+ /, "")
        .replaceAll("**", "")
        .replace(/\[LinkedIn\]\((.*)\)/, "$1")
        .replace(/^---$/, ""),
    );
    const fromMarkdown = check(MARKDOWN.join("\n"), DEFAULT_POLICY, { now });
    const fromPlain = check(plain.join("\n"), DEFAULT_POLICY, { now });
    expect(fromMarkdown.failedChecks.map((rule) => rule.id)).toEqual(
      fromPlain.failedChecks.map((rule) => rule.id),
    );
    expect(fromMarkdown.readinessScore).toBe(fromPlain.readinessScore);
  });

  it("keeps what only looks like the syntax", () => {
    const lines = parseResume(
      ["Jane Doe", "", "Skills", "C#, F#, #1 in regional sales, 5*3 grid, snake_case_names"],
      DEFAULT_POLICY,
      now,
    );
    expect(lines.skills.join(", ")).toContain("C#");
    expect(lines.skills.join(", ")).toContain("snake_case_names");
  });

  it("reads hostile emphasis and link syntax in linear time", () => {
    const line = `${"**a ".repeat(50_000)}${"[x](".repeat(50_000)}`;
    expectFast(() => parseResume(["Jane Doe", line], DEFAULT_POLICY, now), 2_000);
  });
});
