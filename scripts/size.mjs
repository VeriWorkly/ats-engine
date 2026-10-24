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
  // 111: the 0.17.0 audit fixes took it to 109.1, and 0.18.0's leave words, dated-sentence and
  // tagline-name reading to 110.1. 112: 0.21.0's honorifics, region from the header, the
  // "Cargo en Empresa" layout and cities beside dates took it to 111.6. 113: the other languages'
  // words for a current role (reading with AI help) and `universityWords` took it to 112.3. 114:
  // the N4 fixes (bulleted role headers, LinkedIn certification rows, repair keeping only months
  // the document writes, dash-glued emails, policy checks, degree fixes, contact lines, copied
  // requirements and cut warnings) took it to 113.7.
  // 115.5: all of the N4 fixes together came to 115.2.
  ".": 115.5,
  "./document": 3,
  "./format": 1.5,
  // Entity decoding, page-furniture skipping, JSON-LD requirements, hidden-element rules. 4.4: a
  // resume page's style-sheet classes and white text took it to 4.3.
  // 4.6: with the matching fixes (structured fields under headings, double escapes), 4.5.
  // 4.8: classes a sheet shows elsewhere and menus in a navigation or footer took it to 4.6.
  "./job": 4.8,
  // Policy data and every built-in pack. 87: the Spanish and Portuguese packs, the Spain, Brazil
  // and Portugal regions, the city lists (decision D1) and LinkedIn headings added 9 KB. 89: the
  // Mexico, Argentina, Colombia and Chile regions and the honorifics added 1.5 KB. 92: a linguist's
  // review of every pack added 3 KB of headings, titles, degrees and levels; each new pack raises
  // it again. 93: the N4 B24-33 policy checks and degree fixes took it from 91.9 to 92.4.
  "./locales": 93,
  // Core policy data plus redaction; room for the next policy fixes. 79: the 0.17.0 audit fixes'
  // policy data took it to 75.1, and 0.18.0's leave words and phone shapes to 78.0. 80: 0.21.0's
  // policy data and `convertedToDocument` took it to 79.4. 81: suggestion verbs in six languages,
  // dropping invented entries and the N4 policy checks took it to 80.6.
  // 81.5: all of the N4 fixes together came to 81.1.
  "./ai": 81.5,
  // Streamed, size-capped response reading. 2.7: errors sent with HTTP 200, `retry-after`, and a
  // timeout that holds when a host's fetch ignores the signal took them to 2.6.
  "./ai/openai-compatible": 2.7,
  // 2.8: a JSON list answered with HTTP 200 is not retried.
  "./ai/anthropic": 2.8,
  "./ai/testing": 1.5,
  // Zip reader (a JSZip port), PDF and DOCX readers, table detection and DOCX XML guards. 23: clip
  // paths, blend modes and blank images in the hidden-text check took it to 22.7. 25.6: DOCX styles,
  // alternate content and placed parts, PDF layers and part-hidden runs, HTML style sheets, the
  // byte-order mark rule, job pages read in the child and the 50,000-character warning took it to
  // 25.5.
  // 26: all of the N4 fixes together came to 25.7.
  "./node": 26,
};

/**
 * A host importing only some names, against a budget of its own: what it does not import must
 * drop out. The packs' and tasks' JSON Schemas are built at load, so their calls are marked
 * `@__PURE__`; without the marks a bundler keeps them and zod's JSON Schema writer with them.
 */
const NAMED = [
  // 51: 0.21.0's new policy and pack fields. 52: the N4 B24-33 policy checks took it to 51.3.
  ["./locales", ["withLocales"], 52],
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
