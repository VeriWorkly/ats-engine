// Bundle size per public subpath, minified and gzipped, against a budget. Run after `npm run build`.
// A budget is the size when it was set plus headroom; raise it in the same change that earns it.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const { exports } = JSON.parse(readFileSync("package.json", "utf8"));

/** Gzipped KB. */
const BUDGETS = {
  // 95: zod/mini in place of zod (same schemas and messages) took it from 171.9 to 91.7.
  // 97: 0.6.0's reading and keyword fixes took it from 93.6 to 96.2, mostly policy data: the
  // headings, title and organisation words, en-GB stemming rows, injection-mention and
  // citation words, and the section rules that read gutter headings and role sub-headings.
  // 98.6: the department words (0.2), then the names of
  // countries and of the states of the US, Canada, India and Australia and the UK's nations, so
  // "Berlin, Germany" and "Austin, Texas, United States" are where a role is worked (`placeNames`,
  // 1.9 of it data: one string cut at its bars, each country's spellings one pattern), took it
  // from 96.2 to 98.5. No cities: a gazetteer of those would cost tens of KB.
  // 98.7: a LinkedIn export's name read over a headline with no job title, above where the
  // person is, and an employer with its country kept on a line of its own, took it to 98.63.
  // 99.4: the readings 0.4.0 got right restored (an employer with its state's code, a list under
  // a role, the name over its email, a duration over the dates), requirements read clause by
  // clause with the UK's clearance levels, and stricter injection and citation checks, took it to
  // 99.32. 99.7: guards a review found those fixes needed (a sponsorship offered, a verdict in a
  // quoted prompt, the web domains that end a link, a clearance not held past a semicolon) took
  // it to 99.67, mostly policy data (`linkDomains`, `sponsorshipOffered`, `injectionVerdicts`).
  // 99.9: UK levels read in a list and in brackets, the offer of sponsorship read in its clause,
  // and each line's clearances read once, to 99.86. 100.0: the asked level read over a longer
  // list of levels ("BPSS, CTC, SC or DV clearance"), to 99.93.
  ".": 100.0,
  "./document": 3,
  "./format": 1.5,
  // 3.8: entity decoding, page-furniture skipping and structured JSON-LD requirements (0.2), then
  // optional end tags, a tag scan that skips scripts and comments, and hidden-element rules (0.2).
  "./job": 3.8,
  // 70: zod/mini in place of zod took it from 141.1 to 67.5.
  // 70.9: the place names (see "."), and the German pack's for Germany, Austria, Switzerland and
  // the German states, took it from 68.5 to 70.8.
  // 71.1: the policy data this round's fixes added (see ".") took it to 71.08.
  "./locales": 71.1,
  // 70: zod/mini in place of zod took it from 141.0 to 67.5.
  // 71.6: the policy's place names (see "."), with what else "." gained, took it from 69.3 to 71.5.
  // 71.8: the policy data and parsing this round's fixes added (see ".") took it to 71.75.
  // 71.9: the same as "." at 99.9, to 71.84.
  "./ai": 71.9,
  "./ai/openai-compatible": 2,
  "./ai/anthropic": 2,
  "./ai/testing": 1.5,
  // The zip reader is a port of JSZip's, so the expansion budget reads exactly what mammoth will.
  // 17: reading order by geometry, DOCX headers, footers, styles and links, and the PDF link
  // annotations (0.2) took it from 9.7 to 14.0; list-bullet and tab-stop checks, hidden text in
  // DOCX headers, soft masks and HTML resumes, and encoding repair (0.2) to 16.0.
  // 19.5: ruled tables found in the page's own drawing, filled CSS borders included (tables.ts,
  // 1.3), and reading a resume or a posting from a path (`readResumeFile`, `readJobFile`, shared
  // by the CLI and the MCP server, which validate a .json resume with `/document`'s guards, 1.6),
  // took it to 18.9 (0.2).
  // 19.6: the missing-reader message naming the command that installs the readers, and how
  // with -g or npx, took it from 19.44 to 19.52.
  // 20.5: refusing, before mammoth parses it, a DOCX whose XML its parser would take seconds to
  // minutes over (unclosed markup, malformed tags, a prefix bound to two namespaces, thousands of
  // distinct warnings, over 2 MB) took it to 20.0, and reading only a regular local file, measured
  // before it is opened and read through one bounded handle (no network path, pipe or device), to
  // 20.2. The rest is little room: the next addition trims or argues for more.
  // 20.6: reading a PDF's running header and footer once and its page numbers not at all (between
  // two pages they parted a role's title from its dates) took it from 20.20 to 20.57.
  // 20.7: a sidebar taller than the main column read as a column (20.60), and a scan with a
  // scanner's text stamp still counted as a picture (20.66).
  // 20.9: a running header or footer told from body text by the margin it sits in, all of it
  // repeated, and a page number by matching its page (dates opening each page, bullets differing
  // in their figures and a skills line at the foot of two pages were dropped), took it to 20.89.
  "./node": 20.9,
};

let failed = false;
for (const [subpath, budget] of Object.entries(BUDGETS)) {
  const result = await build({
    stdin: { contents: `export * from "${exports[subpath].import}";`, resolveDir: process.cwd() },
    bundle: true,
    minify: true,
    format: "esm",
    platform: subpath === "./node" ? "node" : "neutral",
    mainFields: ["module", "main"],
    external: ["pdfjs-dist", "pdf-parse", "mammoth", "node:*"],
    write: false,
    logLevel: "silent",
  });
  const kb = gzipSync(result.outputFiles[0].contents).length / 1024;
  const over = kb > budget;
  failed ||= over;
  console.log(
    `${over ? "OVER" : "ok  "}  ${subpath.padEnd(24)} ${kb.toFixed(1).padStart(6)} KB gz / ${budget} KB`,
  );
}
process.exitCode = failed ? 1 : 0;
