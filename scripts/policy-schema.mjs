// Writes dist/policy.schema.json, the JSON Schema of a scoring policy, from the zod schema that
// `parseAtsPolicy` validates with. Run by `npm run build`, after the compile. A host points a
// policy file's `$schema` at it for editor completion; `parseAtsPolicy` stays the authority,
// since it also compiles the patterns and checks rule ids are unique, which a schema cannot say.
// It is a file, not a module export, so no bundle grows by it.
import { readFileSync, writeFileSync } from "node:fs";
import * as z from "zod/mini";

import { atsEngineSchema } from "../dist/policy/schema.js";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const generated = z.toJSONSchema(atsEngineSchema, { io: "input", unrepresentable: "any" });

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

// Compact: an editor needs no indentation, and an indented copy adds 140 KB to the package.
writeFileSync(
  "dist/policy.schema.json",
  `${JSON.stringify({ $schema: generated.$schema, ...schema })}\n`,
);
console.log(`policy.schema.json for engine ${version}`);
