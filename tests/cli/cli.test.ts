import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import { main, type CliContext } from "../../src/cli/main.js";
import { PLAIN } from "../../src/cli/terminal.js";
import { ENGINE_VERSION } from "../../src/version.js";
import { LOCALE_FIXTURES, ITALIAN_RESUME } from "../fixtures/locale-resumes.js";
import { buildDocx } from "../fixtures/buildDocx.js";
import { buildPdf, LEFT_COLUMN, RIGHT_COLUMN, text } from "../fixtures/buildPdf.js";
import {
  ASHBY_BOARD,
  ASHBY_JOB_ID,
  GREENHOUSE_JOB,
  GREENHOUSE_JOB_ID,
  LEVER_JOB,
  LEVER_JOB_ID,
} from "../fixtures/jobBoards.js";

const dir = mkdtempSync(join(tmpdir(), "ats-cli-"));
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

function file(name: string, content: string | Buffer) {
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

describe("ats-engine check", () => {
  it("prints the score, what an ATS reads, and the failed checks", async () => {
    expect(await main(["check", file("resume.txt", RESUME)])).toBe(0);

    const printed = out.join("\n");
    expect(printed).toMatch(/^Readiness {2}\d+\/100/);
    expect(printed).toContain("Name     Jane Doe");
    expect(printed).toContain("Email    jane.doe@example.com");
    expect(printed).toMatch(/Role {5}Senior Engineer, Acme Corporation \(Jan 2020 – Present\)/);
  });

  it("prints the certifications and languages an ATS reads", async () => {
    const resume = `${RESUME}\n\nCertifications\nPMP (PMI), expires 2027\n\nLanguages\nEnglish (native), German (B2)`;
    expect(await main(["check", file("credentials.txt", resume)])).toBe(0);
    const printed = out.join("\n");
    expect(printed).toContain("Cert     PMP, PMI, expires 2027");
    expect(printed).toContain("Speaks   English (native), German (B2)");
  });

  it("prints the text as read with --text, and the region it was read in", async () => {
    expect(await main(["check", file("text.txt", RESUME), "--text", "--region", "US"])).toBe(0);
    const printed = out.join("\n");
    expect(printed).toContain("Read as    US");
    expect(printed).toContain(
      "Text as read:\nJane Doe\njane.doe@example.com | (415) 555-0199\nExperience",
    );
  });

  // Detection reads a German resume in German; --lang overrides it, in any case.
  it("reads in the language --lang names, English with --lang en", async () => {
    const german = file("de.txt", LOCALE_FIXTURES.de[0]!.text);
    expect(await main(["check", german])).toBe(0);
    expect(out.join("\n")).toContain("Read as    de, DE");
    out.length = 0;
    expect(await main(["check", german, "--lang", "EN"])).toBe(0);
    // English only; the +49 number still names the region.
    expect(out.join("\n")).toContain("Read as    DE");
    out.length = 0;
    expect(await main(["check", file("en.txt", RESUME), "--lang", "de"])).toBe(0);
    expect(out.join("\n")).toContain("Read as    de");
  });

  it("refuses a --lang no pack has, naming the ones there are", async () => {
    expect(await main(["check", file("x.txt", RESUME), "--lang", "xx"])).toBe(1);
    expect(err.join("\n")).toContain('Unknown --lang "xx"; use one of en, de, fr, hi, es, pt.');
  });

  it("says once when the resume is in a language it does not read yet", async () => {
    const italian = file("it.txt", ITALIAN_RESUME);
    expect(await main(["check", italian])).toBe(0);
    expect(
      out.join("\n").match(/This resume looks Italian, which the engine does not read yet/g),
    ).toHaveLength(1);
    out.length = 0;
    expect(await main(["check", italian, "--job", file("job.txt", "Requirements\n- Go")])).toBe(0);
    expect(
      out.join("\n").match(/This resume looks Italian, which the engine does not read yet/g),
    ).toHaveLength(1);
  });

  it("matches against a job description, including a saved HTML page", async () => {
    const job = file(
      "job.html",
      `<html><body><script type="application/ld+json">${JSON.stringify({
        "@type": "JobPosting",
        title: "Platform Engineer",
        description:
          "<p>Run our platform on Kubernetes. TypeScript and Go required.</p>" +
          "<ul><li>Own the deploy pipeline and on-call rotation</li>" +
          "<li>Design services for payments at scale</li>" +
          "<li>Mentor engineers across two product teams</li>" +
          "<li>Drive incident reviews and reliability work</li></ul>",
      })}</script><nav>Login</nav></body></html>`,
    );
    expect(await main(["check", file("r2.txt", RESUME), "--job", job, "--json"])).toBe(0);

    const report = JSON.parse(out.join("\n"));
    expect(report.jobMatchScore).toEqual(expect.any(Number));
    expect(report.missingKeywords).toContain("kubernetes");
  });

  it("prints a posting's missing soft skills apart from its missing keywords", async () => {
    const job = file(
      "soft.txt",
      "Requirements\n- Kubernetes and Terraform\n- Excellent communication skills\n- Teamwork",
    );
    expect(await main(["check", file("r3.txt", RESUME), "--job", job])).toBe(0);

    const printed = out.join("\n");
    expect(printed).toMatch(/Missing keywords: kubernetes, terraform\n/);
    expect(printed).toContain("Missing soft skills (weigh less): communication, teamwork");
  });

  it("reads a long posting file to 20,000 characters, and says when it cuts one", async () => {
    const about = "Acme values ownership and curiosity in every team.\n".repeat(260);
    const job = file("long.txt", `${about}Requirements\n- Kubernetes and Terraform`);
    expect(await main(["check", file("r-long.txt", RESUME), "--job", job])).toBe(0);
    expect(out.join("\n")).toMatch(/Missing keywords: kubernetes, terraform/);

    out = [];
    const longer = file("longer.txt", `${about}${about}Requirements\n- Kubernetes`);
    expect(await main(["check", file("r-longer.txt", RESUME), "--job", longer])).toBe(0);
    expect(out.join("\n")).toContain(
      "The job posting is 26,545 characters; only its first 20,000 were read.",
    );
  });

  it("reads PDF and DOCX files, measuring a PDF's layout", async () => {
    const ops = LEFT_COLUMN.flatMap((line: string, index: number) => [
      text(45, 720 - index * 26, line),
      text(340, 720 - index * 26, RIGHT_COLUMN[index]!),
    ]).join("\n");
    expect(await main(["check", file("two-column.pdf", buildPdf(ops)), "--json"])).toBe(0);
    const pdfReport = JSON.parse(out.join("\n"));
    const columnRule = pdfReport.rules.find((rule: { id: string }) => /column/i.test(rule.id));
    expect(columnRule?.passed).toBe(false);

    out = [];
    expect(
      await main(["check", file("resume.docx", buildDocx(RESUME.split("\n"))), "--json"]),
    ).toBe(0);
    expect(JSON.parse(out.join("\n")).parsed.name).toBe("Jane Doe");
  }, 60_000);

  it("prints a failed writing check under the Writing label, with its fix", async () => {
    const weak = RESUME.replace(
      "- Built payment systems in TypeScript, cutting failures 40%.",
      "- Responsible for the payment systems in TypeScript\n- Own the checkout flow",
    );
    expect(await main(["check", file("weak.txt", weak)])).toBe(0);
    const printed = out.join("\n");
    expect(printed).toContain(
      'Writing: 1 bullet opens with a duty rather than an action, such as "Responsible for the payment systems in TypeScript".',
    );
    expect(printed).toContain('Fix: Replace "Responsible for", "Worked on"');
  });

  it("gates on --min-score with exit code 2", async () => {
    const resume = file("r3.txt", RESUME);
    expect(await main(["check", resume, "--min-score", "100"])).toBe(2);
    expect(await main(["check", resume, "--min-score", "0"])).toBe(0);
  });

  it.each([
    [["check"], /exactly one resume file/],
    [["check", "a.pages"], /Unsupported resume file type/],
    [["check", "missing.txt"], /ENOENT|no such file/i],
    [["check", "x.txt", "--min-score", "abc"], /--min-score/],
    [["frobnicate"], null],
  ])("exits 1 on %j", async (argv, message) => {
    expect(await main(argv as string[])).toBe(1);
    if (message) expect(err.join("\n")).toMatch(message);
  });

  it("refuses a file with no readable text, the way an ATS would", async () => {
    expect(await main(["check", file("blank.txt", "   ")])).toBe(1);
    expect(err.join("\n")).toMatch(/enough readable text/);
  });

  it("prints the engine version for --version and -v", async () => {
    expect(await main(["--version"])).toBe(0);
    expect(await main(["-v"])).toBe(0);
    expect(out).toEqual([ENGINE_VERSION, ENGINE_VERSION]);
  });

  it("prints usage for --help", async () => {
    expect(await main(["--help"])).toBe(0);
    expect(await main(["check", "--help"])).toBe(0);
    expect(out.join("\n")).toContain("Usage: ats-engine check");
  });
});

describe("ats-engine check --job-url", () => {
  type Call = { url: string; init: RequestInit | undefined };

  /** A board API that answers every request with `answer`, recording what was asked. */
  function board(answer: () => Response | Promise<Response>) {
    const calls: Call[] = [];
    const fetchJob = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return answer();
    }) as typeof fetch;
    const context: CliContext = { terminal: PLAIN, env: {}, fetchJob };
    return { calls, context };
  }
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  const atsNotes = (report: { advice: { id: string }[] }, ats: string) =>
    report.advice.some((item) => item.id.startsWith(`ats.${ats}`));

  it("reads a Greenhouse posting from the board's API, with its employer and the Greenhouse notes", async () => {
    const { calls, context } = board(() => json(GREENHOUSE_JOB));
    const url = `https://job-boards.greenhouse.io/fernbrook/jobs/${GREENHOUSE_JOB_ID}`;
    const argv = ["check", file("gh.txt", RESUME), "--job-url", url, "--json"];
    expect(await main(argv, context)).toBe(0);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      `https://boards-api.greenhouse.io/v1/boards/fernbrook/jobs/${GREENHOUSE_JOB_ID}`,
    );
    expect(calls[0]!.init?.redirect).toBe("manual");
    expect(calls[0]!.init?.signal).toBeInstanceOf(AbortSignal);
    const report = JSON.parse(out.join("\n"));
    expect(report.jobMatchScore).toEqual(expect.any(Number));
    expect(report.missingKeywords).toEqual(expect.arrayContaining(["kubernetes", "terraform"]));
    // The employer the API names is not a keyword the resume should add.
    expect(report.missingKeywords.join(" ")).not.toMatch(/fernbrook/i);
    expect(atsNotes(report, "greenhouse.")).toBe(true);
  });

  it("reads a Greenhouse link that names the job with gh_jid, on the old host", async () => {
    const { calls, context } = board(() => json(GREENHOUSE_JOB));
    const url = `https://boards.greenhouse.io/fernbrook?gh_jid=${GREENHOUSE_JOB_ID}`;
    expect(await main(["check", file("gh2.txt", RESUME), "--job-url", url], context)).toBe(0);
    expect(calls[0]!.url).toBe(
      `https://boards-api.greenhouse.io/v1/boards/fernbrook/jobs/${GREENHOUSE_JOB_ID}`,
    );
    expect(out.join("\n")).toContain("Missing keywords: kubernetes");
  });

  it("reads a Lever posting, its lists included, from the API of the posting's region", async () => {
    const { calls, context } = board(() => json(LEVER_JOB));
    const url = `https://jobs.eu.lever.co/fernbrook/${LEVER_JOB_ID}/apply`;
    const argv = ["check", file("lever.txt", RESUME), "--job-url", url, "--json"];
    expect(await main(argv, context)).toBe(0);

    expect(calls[0]!.url).toBe(`https://api.eu.lever.co/v0/postings/fernbrook/${LEVER_JOB_ID}`);
    const report = JSON.parse(out.join("\n"));
    expect(report.missingKeywords).toEqual(expect.arrayContaining(["airflow", "dbt"]));
    // Lever names no employer; the board's name in the link stands for it.
    expect(report.missingKeywords.join(" ")).not.toMatch(/fernbrook/i);
    expect(atsNotes(report, "lever.")).toBe(true);
  });

  it("reads an Ashby posting by its id from the board's list, with no notes to add", async () => {
    const { calls, context } = board(() => json(ASHBY_BOARD));
    const url = `https://jobs.ashbyhq.com/fernbrook/${ASHBY_JOB_ID}/application`;
    const argv = ["check", file("ashby.txt", RESUME), "--job-url", url, "--json"];
    expect(await main(argv, context)).toBe(0);

    expect(calls[0]!.url).toBe("https://api.ashbyhq.com/posting-api/job-board/fernbrook");
    const report = JSON.parse(out.join("\n"));
    expect(report.missingKeywords).toEqual(expect.arrayContaining(["pytorch", "spark"]));
    // The board's other job is not read, and the board's name is not a keyword.
    expect(report.missingKeywords.join(" ")).not.toMatch(/vendor|fernbrook/i);
    expect(atsNotes(report, "")).toBe(false);
  });

  it("finds an Ashby job from a link that spells its id in capitals", async () => {
    const { context } = board(() => json(ASHBY_BOARD));
    const url = `https://jobs.ashbyhq.com/fernbrook/${ASHBY_JOB_ID.toUpperCase()}`;
    expect(await main(["check", file("ashby3.txt", RESUME), "--job-url", url], context)).toBe(0);
    expect(out.join("\n")).toContain("pytorch");
  });

  // What a company's careers page and Greenhouse's "Apply" frame link to.
  it("reads a Greenhouse embed link, which names the board and the job in its query", async () => {
    const { calls, context } = board(() => json(GREENHOUSE_JOB));
    const url = `https://job-boards.greenhouse.io/embed/job_app?for=fernbrook&token=${GREENHOUSE_JOB_ID}`;
    expect(await main(["check", file("gh4.txt", RESUME), "--job-url", url], context)).toBe(0);
    expect(calls[0]!.url).toBe(
      `https://boards-api.greenhouse.io/v1/boards/fernbrook/jobs/${GREENHOUSE_JOB_ID}`,
    );
  });

  it("keeps the --ats given over the board's", async () => {
    const { context } = board(() => json(GREENHOUSE_JOB));
    const url = `https://job-boards.greenhouse.io/fernbrook/jobs/${GREENHOUSE_JOB_ID}`;
    const argv = ["check", file("gh3.txt", RESUME), "--job-url", url, "--ats", "taleo", "--json"];
    expect(await main(argv, context)).toBe(0);
    const report = JSON.parse(out.join("\n"));
    expect(atsNotes(report, "taleo.")).toBe(true);
    expect(atsNotes(report, "greenhouse.")).toBe(false);
  });

  it.each([
    [`http://boards.greenhouse.io/fernbrook/jobs/${GREENHOUSE_JOB_ID}`, /only https:/],
    ["not a url", /not a web address/],
    ["https://careers.fernbrook.example/jobs/42", /save the page .*--job/i],
    // The board's name before an `@` is a user name; the host is the one after it.
    [
      `https://boards.greenhouse.io@fernbrook.example/x/jobs/${GREENHOUSE_JOB_ID}`,
      /save the page/i,
    ],
    [`https://fernbrook.example/careers?gh_jid=${GREENHOUSE_JOB_ID}`, /save the page/i],
    ["https://boards.greenhouse.io/embed/job_app?for=fernbrook", /not a job posting/],
    ["https://boards.greenhouse.io/fernbrook", /not a job posting.*save the page/i],
    // Greenhouse's EU boards answer on no public API.
    [
      `https://job-boards.eu.greenhouse.io/fernbrook/jobs/${GREENHOUSE_JOB_ID}`,
      /EU boards .*save the page/i,
    ],
    [`https://jobs.lever.co/fern%2F..%2Fx/${LEVER_JOB_ID}`, /not a job posting/],
    ["https://jobs.lever.co/fernbrook/not-an-id", /not a job posting/],
    [`https://jobs.ashbyhq.com/fernbrook/${ASHBY_JOB_ID}/../../x`, /not a job posting/],
  ])("refuses %s before asking anything", async (url, message) => {
    const { calls, context } = board(() => json(GREENHOUSE_JOB));
    expect(await main(["check", file("refused.txt", RESUME), "--job-url", url], context)).toBe(1);
    expect(err.join("\n")).toMatch(message);
    expect(calls).toHaveLength(0);
  });

  it("refuses --job with --job-url", async () => {
    const { calls, context } = board(() => json(GREENHOUSE_JOB));
    const argv = [
      "check",
      file("both.txt", RESUME),
      "--job",
      file("both-job.txt", "Kubernetes"),
      "--job-url",
      `https://job-boards.greenhouse.io/fernbrook/jobs/${GREENHOUSE_JOB_ID}`,
    ];
    expect(await main(argv, context)).toBe(1);
    expect(err.join("\n")).toMatch(/either --job or --job-url/);
    expect(calls).toHaveLength(0);
  });

  const LEVER_URL = `https://jobs.lever.co/fernbrook/${LEVER_JOB_ID}`;

  it.each([
    [
      "a redirect",
      () =>
        new Response(null, { status: 302, headers: { location: "https://elsewhere.example/" } }),
      /api\.lever\.co answered with a redirect/,
    ],
    ["a job that is gone", () => json({ ok: false, error: "Document not found" }, 404), /no job/],
    ["a server error", () => json({}, 503), /api\.lever\.co answered HTTP 503/],
    ["a body that is not JSON", () => new Response("<html>down</html>"), /not JSON/],
    ["JSON that is not a posting", () => json({ ok: true }), /not a Lever posting/],
    [
      "no answer",
      () => Promise.reject(new TypeError("fetch failed", { cause: { code: "ENOTFOUND" } })),
      /could not reach api\.lever\.co \(ENOTFOUND\)/i,
    ],
  ])("fails with one line on %s", async (_name, answer, message) => {
    const { context } = board(answer);
    const argv = ["check", file("fail.txt", RESUME), "--job-url", LEVER_URL];
    expect(await main(argv, context)).toBe(1);
    expect(err).toHaveLength(1);
    expect(err[0]).toMatch(message);
    expect(out.join("\n")).not.toContain("Readiness");
  });

  it("says when an Ashby board does not list the job", async () => {
    const { context } = board(() => json({ ...ASHBY_BOARD, jobs: ASHBY_BOARD.jobs.slice(0, 1) }));
    const url = `https://jobs.ashbyhq.com/fernbrook/${ASHBY_JOB_ID}`;
    expect(await main(["check", file("ashby2.txt", RESUME), "--job-url", url], context)).toBe(1);
    expect(err.join("\n")).toMatch(/no job .*save the page/i);
  });

  it("stops reading an answer past the size limit", async () => {
    // An answer without end: the read must stop at the limit, not when memory runs out.
    let pulled = 0;
    const chunk = new Uint8Array(1024 * 1024).fill(32);
    const endless = () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            pulled += 1;
            controller.enqueue(chunk);
          },
        }),
      );
    const { context } = board(endless);
    const argv = ["check", file("big.txt", RESUME), "--job-url", LEVER_URL];
    expect(await main(argv, context)).toBe(1);
    expect(err.join("\n")).toMatch(/over 20 MB.*save the page/i);
    expect(pulled).toBeLessThan(30);
  });
});
