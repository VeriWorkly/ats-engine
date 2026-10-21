// Writes dist/policy.schema.json from the zod schema `parseAtsPolicy` validates with, for editor
// completion via a policy file's `$schema`. Run by `npm run build`, after the compile.
// `parseAtsPolicy` stays the authority: it also compiles patterns and checks rule ids are unique.
import { readFileSync, writeFileSync } from "node:fs";
import * as z from "zod/mini";

import { atsEngineSchema } from "../dist/policy/schema.js";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const generated = z.toJSONSchema(atsEngineSchema, { io: "input", unrepresentable: "any" });

// Strict, so an editor flags a misspelt key that `parseAtsPolicy` would drop without a word. Only
// objects with a fixed set of keys: maps (synonyms, implies, advice targets) describe their values
// under `additionalProperties` and stay open.
(function strict(node) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) return node.forEach(strict);
  if (node.properties && !("additionalProperties" in node)) node.additionalProperties = false;
  Object.values(node).forEach(strict);
})(generated);

const schema = {
  $schema: generated.$schema,
  $id: `https://cdn.jsdelivr.net/npm/@veriworkly/ats-engine@${version}/dist/policy.schema.json`,
  title: "VeriWorkly ATS Engine scoring policy",
  description: `A scoring policy for @veriworkly/ats-engine ${version}. Validate it with parseAtsPolicy, which also compiles its patterns.`,
  ...generated,
  properties: {
    $schema: { type: "string", description: "The JSON Schema this file follows." },
    ...generated.properties,
  },
};
delete schema.$schema;

// Compact: an indented copy adds 140 KB to the package.
writeFileSync(
  "dist/policy.schema.json",
  `${JSON.stringify({ $schema: generated.$schema, ...schema })}\n`,
);
console.log(`policy.schema.json for engine ${version}`);
