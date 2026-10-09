import { describe, expect, it } from "vitest";

import { AtsScoringService, DEFAULT_POLICY, type AtsLayoutSignals } from "../../src/index.js";

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

  it("still reads the same words when they are visible", () => {
    const report = AtsScoringService.check(RESUME, DEFAULT_POLICY, {
      jobDescription: job,
      now: NOW,
      layout: layout({ hiddenTextChars: 0, hiddenText: "" }),
    });
    expect(report.matchedKeywords).toContain("kubernetes");
  });
});
