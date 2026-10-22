import { describe, expect, it } from "vitest";

import { check, DEFAULT_POLICY } from "../../src/index.js";
import {
  extractJobPosting,
  jobHtmlToText,
  jobTextFromHtml,
  MAX_JOB_TEXT_CHARS,
  normalizeJobText,
} from "../../src/job/index.js";
import { expectFast } from "../fixtures/timing.js";

/** Regressions in `/job`. */

const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
const LONG = "Build and run the data platform. ".repeat(12);

describe("/job regressions", () => {
  it("is not thrown off by text whose lowercase form is longer (İ)", () => {
    const html = `<html><head><title>İstanbul İzmir İnegöl</title>${ld({
      "@type": "JobPosting",
      title: "Mühendis",
      description: LONG,
    })}</head><body><style>p{}</style><p>Kept</p></body></html>`;

    expect(extractJobPosting(html)?.title).toBe("Mühendis");
    expect(jobHtmlToText(html)).toContain("Kept");
  });

  it("survives a huge @graph without overflowing the stack", () => {
    const graph = Array.from({ length: 600_000 }, () => 0);
    graph.push({ "@type": "JobPosting", title: "Deep", description: LONG } as never);
    const html = `<html><head>${ld({ "@graph": graph })}</head><body></body></html>`;

    expect(expectFast(() => extractJobPosting(html), 2_000)?.title).toBe("Deep");
  });

  it("keeps a '<' that does not open a tag", () => {
    expect(jobHtmlToText("<p>Salary <5k for juniors, up to 10k</p><p>Next</p>")).toBe(
      "Salary <5k for juniors, up to 10k\nNext",
    );
    const html = ld({
      "@type": "JobPosting",
      title: "Go dev",
      description: `Must have <3 years of Go. Must know AWS. ${LONG}`,
    });
    expect(extractJobPosting(html)?.description).toContain("Must know AWS");
  });

  it("falls back to the page when the posting's description is only a stub", () => {
    const html = `<html><head>${ld({
      "@type": "JobPosting",
      title: "Engineer",
      description: "See full description below.",
    })}</head><body><h2>Requirements</h2><ul><li>Kubernetes</li><li>Terraform</li></ul></body></html>`;

    expect(jobTextFromHtml(html)).toContain("Kubernetes");
  });

  it("normalises plain job text the same way everywhere", () => {
    expect(normalizeJobText("  Go \t and   Rust \n\n\n Remote  ")).toBe("Go and Rust\nRemote");
    expect(normalizeJobText("x ".repeat(20_000), 100)).toHaveLength(100);
  });

  // A file, a page or a paste was cut at 12,000 characters while `check` read 20,000: the
  // requirements at the end of a long posting were dropped unseen, and the match went up.
  it("reads a posting to the same length on every path, and says when it is cut", () => {
    const about = Array.from(
      { length: 240 },
      (_, i) => `Fabrikam values ownership and curiosity in team ${i}.`,
    ).join("\n");
    const posting = `${about}\nRequirements:\n- 5+ years of Rust\n- Kubernetes in production\n- Terraform`;
    const resume =
      "Avery Quill\navery.quill@example.com\nExperience\nData Engineer, Fabrikam Ltd\nJan 2019 - Present\n- Built pipelines in Python and SQL\nSkills\nPython, SQL";
    const now = new Date("2026-10-01");

    expect(MAX_JOB_TEXT_CHARS).toBe(20_000);
    for (const text of [normalizeJobText(posting), jobHtmlToText(`<pre>${posting}</pre>`)]) {
      expect(text).toContain("Terraform");
      const report = check(resume, DEFAULT_POLICY, { jobDescription: text, now });
      expect(report.requirements).toHaveLength(3);
      expect(report.missingKeywords).toContain("rust");
      expect(report.parsingWarnings.join(" ")).not.toContain("posting");
    }

    const long = `${about}\n${about}\nRequirements:\n- 5+ years of Rust`;
    const cut = check(resume, DEFAULT_POLICY, { jobDescription: normalizeJobText(long), now });
    expect(cut.requirements).toHaveLength(0);
    expect(cut.parsingWarnings).toContain(
      `The job posting is ${long.length.toLocaleString("en")} characters; only its first 20,000 were read.`,
    );
  });
});
