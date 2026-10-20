// Browser and edge smoke test. Run after `npm run build`.
//
// Browser: every runtime-agnostic subpath must bundle for `platform: "browser"`, which fails on
// any Node built-in. Edge: the core, bundled, must score a resume inside a bare V8 context —
// no `process`, `Buffer`, `require` or file system, as in a Workers/Edge runtime. Types: the
// TypeScript samples in the README and LOCALES.md must compile against the built `.d.ts` under
// the strictest options a host may set, `exactOptionalPropertyTypes` among them. Network: the
// subpaths SECURITY.md promises make no network call (the MCP server runs `./node`) must not
// bundle one; only `/ai` reaches a provider, through the fetch its host passes in.
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";
import ts from "typescript";

const { exports } = JSON.parse(readFileSync("package.json", "utf8"));
const BROWSER = [
  ".",
  "./document",
  "./format",
  "./job",
  "./locales",
  "./ai",
  "./ai/openai-compatible",
  "./ai/anthropic",
  "./ai/testing",
];

const NETWORK_FREE = new Set([".", "./document", "./format", "./job", "./locales", "./node"]);
// A network builtin by either name: esbuild leaves `import … from "https"` as written.
const NETWORK =
  /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|["'](?:node:)?(?:https?|http2|net|tls|dgram)["']/;

for (const subpath of [...BROWSER, "./node"]) {
  const node = subpath === "./node";
  const bundled = await build({
    stdin: { contents: `export * from "${exports[subpath].import}";`, resolveDir: process.cwd() },
    bundle: true,
    format: "esm",
    platform: node ? "node" : "browser",
    // The optional readers are the host's install, not this package's code.
    external: node ? ["mammoth", "pdf-parse", "pdfjs-dist"] : [],
    write: false,
    logLevel: "silent",
  });
  const network = NETWORK_FREE.has(subpath) && bundled.outputFiles[0].text.match(NETWORK);
  if (network) throw new Error(`network smoke: ${subpath} bundles "${network[0]}"`);
  if (!node) console.log(`browser  ${subpath}`);
}
console.log(`network  none in ${[...NETWORK_FREE].join(" ")}`);

const core = await build({
  stdin: {
    contents: `import { AtsScoringService, DEFAULT_POLICY } from "${exports["."].import}";
      globalThis.report = AtsScoringService.check(
        "Jane Doe\\njane@example.com\\nExperience\\nEngineer at Acme 2019 - 2022\\n- Built services",
        DEFAULT_POLICY,
        { now: new Date("2026-01-01") },
      );`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
  logLevel: "silent",
});
const sandbox = { TextEncoder, TextDecoder, URL, console };
runInNewContext(core.outputFiles[0].text, sandbox);
if (typeof sandbox.report?.readinessScore !== "number") throw new Error("edge smoke: no report");
console.log(`edge     . (readiness ${sandbox.report.readinessScore})`);

// Schema: the policy's JSON Schema ships at its export, names this version, and describes every
// section of the community policy, so a policy file pointing its `$schema` at it is checked whole.
const policySchema = JSON.parse(readFileSync(exports["./policy.schema.json"], "utf8"));
const { DEFAULT_POLICY } = await import("../dist/index.js");
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const undescribed = Object.keys(DEFAULT_POLICY).filter((key) => !(key in policySchema.properties));
if (!policySchema.$id.includes(`@${version}/`) || undescribed.length > 0)
  throw new Error(
    `schema: policy.schema.json is stale (version ${version}; undescribed: ${undescribed.join(", ") || "none"})`,
  );
console.log(`schema   policy.schema.json covers ${Object.keys(DEFAULT_POLICY).length} sections`);

// Sizes: `npm run size` wrote them for this version, for every subpath a bundler imports, so the
// docs that read their size tables from `./sizes.json` describe this build.
const sizes = JSON.parse(readFileSync(exports["./sizes.json"], "utf8"));
const unsized = Object.keys(exports).filter(
  (subpath) => exports[subpath].import && !(subpath in sizes.subpaths),
);
if (sizes.version !== version || unsized.length > 0)
  throw new Error(
    `sizes: sizes.json is stale (version ${sizes.version} for ${version}; missing: ${unsized.join(", ") || "none"}); run npm run size`,
  );
console.log(`sizes    sizes.json covers ${Object.keys(sizes.subpaths).length} subpaths`);

// Each sample is its own module beside package.json, so `@veriworkly/ats-engine` resolves to this
// package's exports. The names a sample uses without defining are declared for it.
const DECLARED = ["resume", "resumeText", "postingHtml", "jobDescription"]
  .map((name) => `declare const ${name}: string;`)
  .join(" ");
const root = process.cwd().replaceAll("\\", "/"); // TypeScript's form of a path
const samples = new Map();
for (const doc of ["README.md", "LOCALES.md"]) {
  const blocks = readFileSync(doc, "utf8").matchAll(/^```ts\r?\n([\s\S]*?)^```/gm);
  for (const [index, [, code]] of [...blocks].entries())
    samples.set(`${root}/${doc}.sample-${index + 1}.ts`, `${DECLARED}\n${code}`);
}
// What a host writes beyond the docs, which must keep compiling: its own exact-optional types
// filled from what the package returns (so a returned type never gains `| undefined`), and a
// retry hook typed for one task, or left out with `undefined`.
samples.set(
  `${root}/host.sample.ts`,
  `import { DEFAULT_POLICY, check, fromJsonResume, prepareResume } from "@veriworkly/ats-engine";
import { AtsAiError, createAtsAi } from "@veriworkly/ats-engine/ai";
import { anthropic } from "@veriworkly/ats-engine/ai/anthropic";
import { scriptedProvider } from "@veriworkly/ats-engine/ai/testing";
import { extractResume, readResumeFile } from "@veriworkly/ats-engine/node";

type Basics = { name: string; headline?: string; email?: string; links?: string[] };
type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens?: number };
type Layout = { tableCount: number; pageCount: number; imageCount?: number; encrypted?: boolean };
type File = { name?: string; bytes?: number; passwordProtected?: boolean };
type Reply = { text: string; id?: string; usage?: Usage };

export const basics: Basics = fromJsonResume({}).basics;
export const prepared: Basics | undefined = prepareResume("text").document?.basics;

const onlyAnalyze = (event: { task: "analyze"; attempt: number; error: AtsAiError }) => event.task;
const provider = scriptedProvider("{}");
export const ai = createAtsAi({ provider, hooks: { onRetry: onlyAnalyze } });
export const quiet = createAtsAi({ provider, hooks: { onRetry: undefined } });
const { usage } = await ai.analyze({ resumeText: "text", report: check("text", DEFAULT_POLICY) });
export const used: Usage | undefined = usage;
export const failed = (error: AtsAiError): Usage | undefined => error.usage;

export const measured: Layout | undefined = (await extractResume(new Uint8Array(), "pdf")).layout;
export const info: File = (await readResumeFile("resume.pdf")).file;
export const reply: Reply = await anthropic({ apiKey: "key" }).complete({
  model: "model",
  system: "",
  messages: [],
  maxTokens: 1,
});
`,
);
const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.NodeNext,
  moduleResolution: ts.ModuleResolutionKind.NodeNext,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts"],
  types: ["node"],
  strict: true,
  exactOptionalPropertyTypes: true,
  noUncheckedIndexedAccess: true,
  noEmit: true,
};
const host = ts.createCompilerHost(options);
const { fileExists, readFile, getSourceFile } = host;
host.fileExists = (name) => samples.has(name) || fileExists(name);
host.readFile = (name) => samples.get(name) ?? readFile(name);
host.getSourceFile = (name, language, ...rest) =>
  samples.has(name)
    ? ts.createSourceFile(name, samples.get(name), language)
    : getSourceFile(name, language, ...rest);
const errors = ts.getPreEmitDiagnostics(ts.createProgram([...samples.keys()], options, host));
if (errors.length > 0)
  throw new Error(
    `types: the samples do not compile\n${ts.formatDiagnostics(errors, {
      getCanonicalFileName: (name) => name,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => "\n",
    })}`,
  );
console.log(`types    ${samples.size} samples: README.md, LOCALES.md and a host's own types`);
