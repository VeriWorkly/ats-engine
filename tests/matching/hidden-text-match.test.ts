import { describe, expect, it } from "vitest";

import { AtsScoringService, DEFAULT_POLICY, type AtsLayoutSignals } from "../../src/index.js";
import { expectFast } from "../fixtures/timing.js";

const NOW = new Date("2024-06-01");
const filler = "Agile Scrum Jira Confluence Bitbucket Jenkins Ansible Puppet Chef Vagrant Nagios";
const stuffed = "Kubernetes Terraform Kafka Snowflake";

const RESUME = [
  "Jane Doe",
  "jane.doe@example.com | (415) 555-0199",
  "",
  "Experience",
  "Senior Engineer, Acme Corporation",
  "Jan 2020 - Present",
  "- Built payment systems in TypeScript, cutting failures 40%.",
  filler,
  stuffed,
  "",
  "Skills",
  "TypeScript, Go, PostgreSQL",
].join("\n");

const layout = (hidden: Partial<AtsLayoutSignals>): AtsLayoutSignals => ({
  columnRatio: 0,
  tableCount: 0,
  pageCount: 1,
  imageCount: 0,
  hiddenTextChars: `${filler} ${stuffed}`.length,
  ...hidden,
});

describe("hidden text and the job match", () => {
  const job = "We need Kubernetes, Terraform and Kafka experience.";

  it("leaves hidden lines past the first 80 characters out of the match", () => {
    const report = AtsScoringService.check(RESUME, DEFAULT_POLICY, {
      jobDescription: job,
      now: NOW,
      layout: layout({
        hiddenTextSample: `${filler} ${stuffed}`.slice(0, 80),
        hiddenText: `${filler} ${stuffed}`,
      }),
    });
    expect(report.matchedKeywords).not.toContain("kubernetes");
    expect(report.matchedKeywords).not.toContain("kafka");
    for (const requirement of report.requirements)
      expect(requirement.evidence.join(" ")).not.toContain("Kubernetes");
  });

  // The hidden block holds the same word as a visible line. Each hidden occurrence sets aside one
  // line, longest first: the visible "Kubernetes" skill was set aside with the block it repeats.
  it("keeps a visible line whose text the hidden text also holds", () => {
    const visible = RESUME.replace("TypeScript, Go, PostgreSQL", "Kubernetes");
    const report = AtsScoringService.check(visible, DEFAULT_POLICY, {
      jobDescription: job,
      now: NOW,
      layout: layout({ hiddenTextSample: stuffed, hiddenText: `${filler} ${stuffed}` }),
    });
    expect(report.matchedKeywords).toContain("kubernetes");
    expect(report.matchedKeywords).not.toContain("kafka");
  });

  // A visible line across the end of one hidden line and the start of the next: cutting it out
  // of the hidden text left neither hidden line to find, and both counted as evidence.
  it.each([
    ["across two", ["Kafka Kubernetes", "Terraform Spark"], "Kubernetes Terraform"],
    ["overlapping", ["Kafka Spark", "Spark Terraform Kubernetes"], "Spark Terraform"],
  ])("never counts hidden lines a visible line runs %s of", (_, hiddenLines, visibleLine) => {
    const hiddenText = hiddenLines.join(" ");
    const resume = [
      "Jane Doe",
      "jane.doe@example.com",
      "Experience",
      "Senior Engineer, Acme Corporation",
      "Jan 2020 - Present",
      ...hiddenLines,
      "Skills",
      visibleLine,
    ].join("\n");
    const report = AtsScoringService.check(resume, DEFAULT_POLICY, {
      jobDescription: "Experience with Kafka / Spark / Kubernetes and Terraform",
      now: NOW,
      layout: layout({ hiddenTextSample: hiddenText, hiddenText, hiddenTextChars: 200 }),
    });
    expect(report.matchedKeywords).not.toContain("kafka");
    for (const requirement of report.requirements)
      for (const line of hiddenLines) expect(requirement.evidence).not.toContain(line);
  });

  it("sets hidden lines aside in bounded time", () => {
    const words = Array.from({ length: 25_000 }, (_, i) => `word${i % 50}`);
    const resume = `Jane Doe\njane@example.com\n${words.join("\n")}`;
    const hiddenText = words.slice(0, 600).join(" ");
    expectFast(
      () =>
        AtsScoringService.check(resume, DEFAULT_POLICY, {
          jobDescription: job,
          now: NOW,
          layout: layout({
            hiddenTextSample: hiddenText.slice(0, 80),
            hiddenText,
            hiddenTextChars: 5_000,
          }),
        }),
      1_500,
    );
  });

  it("still reads the same words when they are visible", () => {
    const report = AtsScoringService.check(RESUME, DEFAULT_POLICY, {
      jobDescription: job,
      now: NOW,
      layout: layout({ hiddenTextChars: 0, hiddenText: "" }),
    });
    expect(report.matchedKeywords).toContain("kubernetes");
  });
});
