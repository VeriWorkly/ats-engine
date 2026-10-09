// Bundle size per public subpath, minified and gzipped, against a budget. Run after `npm run build`.
// A budget is the size when it was set plus headroom; raise it in the same change that earns it.
import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const { exports } = JSON.parse(readFileSync("package.json", "utf8"));

/** Gzipped KB. */
const BUDGETS = {
  // 165: the October audit's vocabulary (headings, degrees, title and place words) filled 160;
  // Markdown reading, role headers with a location and names left out of a posting's keywords
  // (proseNames) took it to 160.2 (0.2). Most of the bundle is policy data, not code.
  // 170: certifications and spoken languages read as rows (their parsers, CEFR level words and
  // the requirement judging over them, 4.1) and the writing rules (their checks and word lists,
  // 2.7) took it from 161.2 to 168.0 (0.3). zod is about half of the entry: zod/mini is the trim.
  ".": 170,
  "./document": 3,
  "./format": 1.5,
  // 3.8: entity decoding, page-furniture skipping and structured JSON-LD requirements (0.2), then
  // optional end tags, a tag scan that skips scripts and comments, and hidden-element rules (0.2).
  "./job": 3.8,
  "./locales": 145,
  "./ai": 140,
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
  "./node": 19.5,
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
