// Bundle size per public subpath, minified and gzipped, against a budget. Run after `npm run build`.
// A budget is the size when it was set plus headroom; raise it in the same change that earns it.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const { exports } = JSON.parse(readFileSync("package.json", "utf8"));

/** Gzipped KB. */
const BUDGETS = {
  // 95: zod/mini in place of zod (same schemas and messages) took it from 171.9 to 91.7.
  ".": 95,
  "./document": 3,
  "./format": 1.5,
  // 3.8: entity decoding, page-furniture skipping and structured JSON-LD requirements (0.2), then
  // optional end tags, a tag scan that skips scripts and comments, and hidden-element rules (0.2).
  "./job": 3.8,
  // 70: zod/mini in place of zod took it from 141.1 to 67.5.
  "./locales": 70,
  // 70: zod/mini in place of zod took it from 141.0 to 67.5.
  "./ai": 70,
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
  "./node": 20.6,
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
