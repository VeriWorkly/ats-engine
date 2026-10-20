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

  // White "Kafka Kubernetes" drawn after "Senior Engineer" on one line: on a PDF, whose hidden
  // runs are all among its lines, it is cut from that line and the rest of the line stays.
  const glued = [
    "Jane Doe",
    "jane.doe@example.com",
    "Experience",
    "Senior Engineer Kafka Kubernetes",
    "Jan 2020 - Present",
    "- Built payment systems in Python for 2 million users.",
    "Skills",
    "Python, Terraform",
  ].join("\n");
  const gluedJob = "Experience with Python, Terraform, Kafka and Kubernetes";

  it("cuts hidden text inside a visible line when the hidden runs are among the lines", () => {
    const report = AtsScoringService.check(glued, DEFAULT_POLICY, {
      jobDescription: gluedJob,
      now: NOW,
      layout: layout({
        hiddenTextSample: "Kafka Kubernetes",
        hiddenText: "Kafka Kubernetes",
        hiddenTextChars: 200,
        hiddenTextRead: "Kafka Kubernetes",
      }),
    });
    expect(report.matchedKeywords).toEqual(expect.arrayContaining(["python", "terraform"]));
    expect(report.matchedKeywords).not.toContain("kafka");
    expect(report.matchedKeywords).not.toContain("kubernetes");
  });

  // The hidden copy is drawn against punctuation ("Kafka-based") or across two lines, so the one
  // copy held between word ends is a visible one: a word the kept lines hold more often than the
  // hidden text owes is not cut, and the visible skill stays.
  it.each([
    [
      "against punctuation",
      ["- Built Kafka-based pipelines", "Skills", "Kafka Kubernetes"],
      "Kafka",
      "kafka",
    ],
    [
      "across two lines",
      [
        "- Led the data team Machine",
        "- Learning curve shortened",
        "- Applied Machine Learning to fraud",
      ],
      "Machine Learning",
      "machine learning",
    ],
  ])("cuts no visible copy when the hidden one is %s", (_, body, hiddenText, term) => {
    const resume = ["Jane Doe", "jane.doe@example.com", "Experience", ...body].join("\n");
    const report = AtsScoringService.check(resume, DEFAULT_POLICY, {
      jobDescription: "Experience with Kafka, Kubernetes and Machine Learning",
      now: NOW,
      layout: layout({
        hiddenTextSample: hiddenText,
        hiddenText,
        hiddenTextChars: 200,
        hiddenTextRead: hiddenText,
      }),
    });
    expect(report.matchedKeywords).toContain(term);
    expect(
      report.requirements.some((r) => r.evidence.some((line) => line.includes("\u2063"))),
    ).toBe(false);
  });

  // The visible twins of two hidden lines are set aside in their place: the hidden lines kept
  // are read apart, so they make no phrase together.
  it("reads apart the kept copies of a line whose other copies are set aside", () => {
    const resume = [
      "Jane Doe",
      "jane.doe@example.com",
      "Experience",
      "Built Python Machine",
      "Learning Spark Jobs",
      "Projects",
      "Built Python Machine",
      "Awards",
      "Learning Spark Jobs",
    ].join("\n");
    const hiddenText =
      `Built Python Machine Learning Spark Jobs ${"Built Python Machine ".repeat(240)}`.trim();
    const report = AtsScoringService.check(resume, DEFAULT_POLICY, {
      jobDescription: "Experience with Python, Spark and Machine Learning",
      now: NOW,
      layout: layout({
        hiddenTextSample: hiddenText.slice(0, 80),
        hiddenText: hiddenText.slice(0, 5_000),
        hiddenTextChars: 6_000,
      }),
    });
    expect(report.matchedKeywords).not.toContain("machine learning");
  });

  // A web page's hidden element, or a Word header's hidden run, is reported hidden but is not in
  // the text: no ATS reads it, so the visible line that repeats it stays whole.
  it("sets aside nothing for hidden text the lines do not hold", () => {
    const resume = ["Jane Doe", "jane.doe@example.com", "Skills", "Kafka Kubernetes"].join("\n");
    const report = AtsScoringService.check(resume, DEFAULT_POLICY, {
      jobDescription: "Experience with Kafka and Kubernetes",
      now: NOW,
      layout: layout({
        hiddenTextSample: "Kafka Kubernetes",
        hiddenText: "Kafka Kubernetes",
        hiddenTextChars: 200,
        hiddenTextRead: "",
      }),
    });
    expect(report.matchedKeywords).toEqual(expect.arrayContaining(["kafka", "kubernetes"]));
  });

  // A layout from an older extractor, or a host that passes only `hiddenText`, does not say which
  // hidden text the lines hold: nothing is cut from a visible line, as before.
  it("cuts nothing from a visible line when the layout does not say what the lines hold", () => {
    const report = AtsScoringService.check(glued, DEFAULT_POLICY, {
      jobDescription: gluedJob,
      now: NOW,
      layout: layout({
        hiddenTextSample: "Kafka Kubernetes",
        hiddenText: "Kafka Kubernetes",
        hiddenTextChars: 200,
      }),
    });
    expect(report.matchedKeywords).toEqual(expect.arrayContaining(["kafka", "kubernetes"]));
  });

  // A second column's hidden runs read first, and a visible "Airflow Kafka" across their join:
  // it splits into their texts one way only, so those lines are set aside and the visible stay.
  it("sets aside the hidden lines when the hidden text runs in another order", () => {
    const resume = [
      "Jane Doe",
      "jane.doe@example.com",
      "Experience",
      "Kafka Spark",
      "Snowflake Airflow",
      "Skills",
      "Airflow Kafka",
    ].join("\n");
    const hiddenText = "Snowflake Airflow Kafka Spark";
    const report = AtsScoringService.check(resume, DEFAULT_POLICY, {
      jobDescription: "Experience with Kafka, Spark, Snowflake and Airflow",
      now: NOW,
      layout: layout({ hiddenTextSample: hiddenText, hiddenText, hiddenTextChars: 200 }),
    });
    expect(report.matchedKeywords).toEqual(expect.arrayContaining(["airflow", "kafka"]));
    expect(report.matchedKeywords).not.toContain("snowflake");
    expect(report.matchedKeywords).not.toContain("spark");
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

/**
 * What hidden text costs and lets through, held as it stands: generated resumes of each shape the
 * engine meets (hidden lines, a white block wrapped over two lines, a second column's hidden runs
 * read first, lines written twice, white text drawn after visible text on one line, and hidden
 * text the text does not hold), each judged against what a reader sees. A skill only hidden text
 * names must never match; visible skills lost may fall, never rise.
 */
describe("hidden text across generated resumes", () => {
  const VOCAB = [
    "Kubernetes",
    "Terraform",
    "Kafka",
    "Spark",
    "Python",
    "Docker",
    "Snowflake",
    "Airflow",
  ];
  const posting = `Requirements\n${VOCAB.map((skill) => `- Experience with ${skill}`).join("\n")}`;
  let seed = 11;
  const random = () => (seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648) / 2_147_483_648;
  const int = (n: number) => Math.floor(random() * n);
  const pick = (n: number) => {
    const left = [...VOCAB];
    return Array.from({ length: n }, () => left.splice(int(left.length), 1)[0]!);
  };
  const SHAPES = ["lines", "wrapped", "reordered", "dupes", "inline", "outside"] as const;

  it("matches no hidden-only skill and loses no more visible ones", () => {
    const tally = Object.fromEntries(SHAPES.map((shape) => [shape, { leaked: 0, lost: 0 }]));
    for (let n = 0; n < 600; n++) {
      const shape = SHAPES[n % SHAPES.length]!;
      let hiddenLines: string[];
      let hiddenText: string;
      if (shape === "wrapped") {
        const block = pick(4 + int(4));
        const at = 1 + int(block.length - 1);
        hiddenLines = [block.slice(0, at).join(" "), block.slice(at).join(" ")];
        hiddenText = block.join(" ");
      } else {
        hiddenLines = Array.from({ length: 1 + int(3) }, () => pick(1 + int(3)).join(" "));
        hiddenText = (shape === "reordered" ? [...hiddenLines].reverse() : hiddenLines).join(" ");
      }
      const words = hiddenText.split(" ");
      let visible = Array.from({ length: 1 + int(3) }, () => {
        const r = random();
        if (r < 0.25) return hiddenLines[int(hiddenLines.length)]!;
        if (r < 0.55 && words.length > 1) {
          const at = int(words.length - 1);
          return words.slice(at, at + 1 + int(2)).join(" ");
        }
        return pick(1 + int(2)).join(" ");
      });
      if (shape === "dupes") visible = [...visible, ...visible];
      const seen = new Set(visible.join(" ").toLowerCase().split(" "));
      let body = hiddenLines;
      if (shape === "inline") {
        const host = pick(1)[0]!;
        seen.add(host.toLowerCase());
        body = [`${host} ${hiddenLines[0]}`, ...hiddenLines.slice(1)];
      }
      if (shape === "outside") body = [];
      const resume = [
        "Jane Doe",
        "jane.doe@example.com",
        "Experience",
        "Senior Engineer, Acme Corporation",
        "Jan 2020 - Present",
        ...body,
        "Skills",
        ...visible,
      ].join("\n");
      const report = AtsScoringService.check(resume, DEFAULT_POLICY, {
        jobDescription: posting,
        now: NOW,
        layout: layout({
          hiddenText,
          hiddenTextSample: hiddenText.slice(0, 80),
          hiddenTextChars: 200,
          hiddenTextRead: shape === "outside" ? "" : hiddenText,
        }),
      });
      const matched = new Set(report.matchedKeywords);
      for (const skill of VOCAB.map((word) => word.toLowerCase())) {
        if (matched.has(skill) && !seen.has(skill)) tally[shape]!.leaked += 1;
        if (seen.has(skill) && !matched.has(skill)) tally[shape]!.lost += 1;
      }
    }
    // Today, out of 100 each; lower it when a change does better.
    const lostAtMost = { lines: 0, wrapped: 0, reordered: 1, dupes: 0, inline: 0, outside: 0 };
    for (const shape of SHAPES) {
      expect(tally[shape]!.leaked, `${shape}: hidden-only skills matched`).toBe(0);
      expect(tally[shape]!.lost, `${shape}: visible skills lost`).toBeLessThanOrEqual(
        lostAtMost[shape],
      );
    }
  });
});
