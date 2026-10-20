// Bundle size per public subpath, minified and gzipped, against a budget. Run after `npm run build`.
// A budget is the size when set plus headroom; raise it in the change that earns it.
// Writes dist/sizes.json (exported as `./sizes.json`), which the docs read their size tables from.
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";

const { exports, version } = JSON.parse(readFileSync("package.json", "utf8"));

/** Gzipped KB. */
const BUDGETS = {
  // Core: policy data (word lists, place names, clearance levels) grows with each reading fix.
  ".": 106,
  "./document": 3,
  "./format": 1.5,
  // Entity decoding, page-furniture skipping, JSON-LD requirements, hidden-element rules.
  "./job": 3.8,
  // Policy data, the language detection words and the French pack; room for one more pack.
  "./locales": 79.5,
  // Core policy data plus redaction; room for the next policy fixes.
  "./ai": 75,
  // Streamed, size-capped response reading.
  "./ai/openai-compatible": 2.4,
  "./ai/anthropic": 2.4,
  "./ai/testing": 1.5,
  // Zip reader (a JSZip port), PDF and DOCX readers, table detection and DOCX XML guards.
  "./node": 22.5,
};

/**
 * A host importing only some names, against a budget of its own: what it does not import must
 * drop out. The packs' and tasks' JSON Schemas are built at load, so their calls are marked
 * `@__PURE__`; without the marks a bundler keeps them and zod's JSON Schema writer with them.
 */
const NAMED = [
  ["./locales", ["withLocales"], 50.5],
  [
    "./ai",
    ["AtsAiError", "DEFAULT_ANALYZE_PROMPT", "DEFAULT_CONVERT_PROMPT", "DEFAULT_REPAIR_PROMPT"],
    9.5,
  ],
];

const entries = [
  ...Object.entries(BUDGETS).map(([subpath, budget]) => [subpath, subpath, "*", budget]),
  ...NAMED.map(([subpath, names, budget]) => [
    `${subpath} { ${names.length > 1 ? `${names[0]}, +${names.length - 1}` : names[0]} }`,
    subpath,
    `{ ${names.join(", ")} }`,
    budget,
  ]),
];

let failed = false;
const measured = { version, unit: "KB, minified and gzipped", subpaths: {}, imports: {} };
for (const [label, subpath, names, budget] of entries) {
  const result = await build({
    stdin: {
      contents: `export ${names} from "${exports[subpath].import}";`,
      resolveDir: process.cwd(),
    },
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
  const size = { kb: Math.round(kb * 10) / 10, budget };
  if (names === "*") measured.subpaths[subpath] = size;
  else measured.imports[label] = { subpath, names: names.slice(2, -2).split(", "), ...size };
  const over = kb > budget;
  failed ||= over;
  console.log(
    `${over ? "OVER" : "ok  "}  ${label.padEnd(30)} ${kb.toFixed(1).padStart(6)} KB gz / ${budget} KB`,
  );
}
writeFileSync("dist/sizes.json", `${JSON.stringify(measured, null, 2)}\n`);
process.exitCode = failed ? 1 : 0;
