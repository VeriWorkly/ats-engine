// After `changeset version`: copy package.json's version into ENGINE_VERSION, which every report
// is stamped with, and into the GitHub Action's default engine version; and the MCP package's
// version into its registry metadata, packages/mcp/server.json. Tests hold each pair equal.
import { readFileSync, writeFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const file = "src/version.ts";
const source = readFileSync(file, "utf8");
const updated = source.replace(/ENGINE_VERSION = "[^"]*"/, `ENGINE_VERSION = "${version}"`);
if (updated === source && !source.includes(`"${version}"`))
  throw new Error("ENGINE_VERSION not found");
writeFileSync(file, updated);
console.log(`ENGINE_VERSION = ${version}`);

const actionFile = "action/action.yml";
const action = readFileSync(actionFile, "utf8");
// The `default:` of the `version` input, the first one after its key.
const pinned = action.replace(
  /(\n {2}version:\n(?: {4}.*\n)*? {4}default: )"[^"]*"/,
  `$1"${version}"`,
);
if (!pinned.includes(`default: "${version}"`)) throw new Error("action version not found");
writeFileSync(actionFile, pinned);
console.log(`${actionFile} version = ${version}`);

const mcp = JSON.parse(readFileSync("packages/mcp/package.json", "utf8"));
const serverFile = "packages/mcp/server.json";
const server = JSON.parse(readFileSync(serverFile, "utf8"));
server.version = mcp.version;
for (const entry of server.packages) if (entry.identifier === mcp.name) entry.version = mcp.version;
writeFileSync(serverFile, `${JSON.stringify(server, null, 2)}\n`);
console.log(`${serverFile} version = ${mcp.version}`);
