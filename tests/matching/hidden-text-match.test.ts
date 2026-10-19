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

  // The hidden lines, read in order, are the hidden text whole, so they and only they are set
  // aside: a visible line that runs where two of them meet keeps its words.
  it.each([
    [
      "the wrap of a hidden block",
      ["Python Java Docker", "Kubernetes Terraform"],
      "Docker Kubernetes",
      ["docker", "kubernetes"],
      ["python", "java", "terraform"],
    ],
    [
      "two hidden lines",
      ["Airflow", "Docker Kubernetes"],
      "Airflow Docker",
      ["airflow", "docker"],
      ["kubernetes"],
    ],
  ])("keeps a visible line across %s", (_, hiddenLines, visibleLine, kept, dropped) => {
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
      jobDescription: "Experience with Python, Java, Docker, Kubernetes, Terraform and Airflow",
      now: NOW,
      layout: layout({ hiddenTextSample: hiddenText, hiddenText, hiddenTextChars: 200 }),
    });
    for (const term of kept) expect(report.matchedKeywords).toContain(term);
    for (const term of dropped) expect(report.matchedKeywords).not.toContain(term);
  });

  // Hidden text read in another order than the lines (a second column's runs first) has no
  // lines that join to it; the longest lines still claim theirs, and nothing hidden counts.
  it("counts nothing hidden when the hidden text runs in another order than the lines", () => {
    const resume = [
      "Jane Doe",
      "jane.doe@example.com",
      "Experience",
      "Senior Engineer, Acme Corporation",
      "Jan 2020 - Present",
      "Kafka Spark",
      "Snowflake Airflow",
      "Skills",
      "Python",
    ].join("\n");
    const hiddenText = "Snowflake Airflow Kafka Spark";
    const report = AtsScoringService.check(resume, DEFAULT_POLICY, {
      jobDescription: "Experience with Python, Kafka, Spark, Snowflake and Airflow",
      now: NOW,
      layout: layout({ hiddenTextSample: hiddenText, hiddenText, hiddenTextChars: 200 }),
    });
    expect(report.matchedKeywords).toContain("python");
    for (const term of ["kafka", "spark", "snowflake", "airflow"])
      expect(report.matchedKeywords).not.toContain(term);
  });

  // Lines are given here as [text, hidden?]: the hidden ones, joined, are the hidden text.
  const read = (lines: Array<[string, boolean]>, jobDescription: string) => {
    const hiddenText = lines
      .filter(([, hidden]) => hidden)
      .map(([text]) => text)
      .join(" ");
    const resume = ["Jane Doe", "jane.doe@example.com", ...lines.map(([text]) => text)].join("\n");
    return AtsScoringService.check(resume, DEFAULT_POLICY, {
      jobDescription,
      now: NOW,
      layout: layout({
        hiddenTextSample: hiddenText.slice(0, 80),
        hiddenText,
        hiddenTextChars: 200,
      }),
    });
  };

  // "Go Machine" / "Learning" / "Learning Big" also join to the hidden text: split two ways, a
  // phrase could be in either, so no set of lines is trusted and the longest lines claim theirs.
  it("trusts no set of lines when the hidden text splits two ways", () => {
    const report = read(
      [
        ["Experience", false],
        ["Go", true],
        ["Certifications", false],
        ["Go Machine", false],
        ["Machine Learning Learning", true],
        ["Education", false],
        ["Learning", false],
        ["Learning Big", false],
        ["Big", true],
        ["AWS", false],
      ],
      "Experience with Go, AWS and Machine Learning",
    );
    expect(report.matchedKeywords).not.toContain("machine learning");
  });

  // The hidden "Machine" and "Learning" are the last two lines; the visible ones come first. The
  // lines set aside are those that join to the hidden text, not the first lines with their words.
  it("sets aside the hidden copies of a line, not the first ones", () => {
    const report = read(
      [
        ["Experience", false],
        ["Python Kafka Science", false],
        ["Awards", false],
        ["Machine", false],
        ["Education", false],
        ["Learning", false],
        ["Python Kafka Science", true],
        ["Projects", false],
        ["Machine", true],
        ["Learning", true],
      ],
      "Experience with Python, Kafka, Science and Machine Learning",
    );
    expect(report.matchedKeywords).toEqual(expect.arrayContaining(["python", "kafka"]));
    expect(report.matchedKeywords).not.toContain("machine learning");
  });

  // Setting aside "Science Spark" must not make "Machine" and "Learning" a phrase: the lines
  // either side of a line set aside are read apart.
  it("reads no phrase across a line set aside", () => {
    const report = read(
      [
        ["Experience", false],
        ["Machine Science", true],
        ["Spark", true],
        ["Machine", false],
        ["Science Spark", false],
        ["Learning", false],
      ],
      "Experience with Spark, Science and Machine Learning",
    );
    expect(report.matchedKeywords).not.toContain("machine learning");
  });

  // A hidden "Go" glued to a visible word: a line under four characters is never set aside, so
  // the visible "Go" skill stays, as it always did.
  it("never sets aside a line under four characters", () => {
    const resume = ["Jane Doe", "jane.doe@example.com", "Skills", "Go", "Languages: PythonGo"].join(
      "\n",
    );
    const report = AtsScoringService.check(resume, DEFAULT_POLICY, {
      jobDescription: "Experience with Go, Python and SQL",
      now: NOW,
      layout: layout({ hiddenTextSample: "Go", hiddenText: "Go", hiddenTextChars: 2 }),
    });
    expect(report.matchedKeywords).toContain("go");
  });

  it("gives up looking for the hidden lines in bounded time on one line over and over", () => {
    const hiddenText = Array.from({ length: 1_600 }, () => "Go").join(" ");
    const resume = `Jane Doe\njane@example.com\n${Array.from({ length: 15_000 }, () => "Go").join("\n")}`;
    expectFast(
      () =>
        AtsScoringService.check(resume, DEFAULT_POLICY, {
          jobDescription: job,
          now: NOW,
          layout: layout({
            hiddenTextSample: hiddenText.slice(0, 80),
            hiddenText,
            hiddenTextChars: 3_200,
          }),
        }),
      1_500,
    );
  });

  it("sets hidden lines aside in bounded time when many short lines repeat in the hidden text", () => {
    const words = Array.from({ length: 12_000 }, (_, i) => `ab${i % 11}`);
    const resume = `Jane Doe\njane@example.com\n${words.join("\n")}`;
    const hiddenText = words.slice(0, 1_250).join(" ");
    expectFast(
      () =>
        AtsScoringService.check(resume, DEFAULT_POLICY, {
          jobDescription: job,
          now: NOW,
          layout: layout({
            hiddenTextSample: hiddenText.slice(0, 80),
            hiddenText,
            hiddenTextChars: 4_000,
          }),
        }),
      1_500,
    );
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
