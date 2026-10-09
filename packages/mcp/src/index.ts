#!/usr/bin/env node
/**
 * `npx -y @veriworkly/ats-engine-mcp`: the ATS Engine MCP server over stdio.
 *
 * stdout carries the protocol and nothing else, so anything that would print to it — a library's
 * stray `console.log` — goes to stderr instead.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createServer } from "./server.js";

const toStderr = (...args: unknown[]) => console.error(...args);
console.log = console.info = console.debug = toStderr;

const server = createServer();
await server.connect(new StdioServerTransport());
console.error("ats-engine-mcp: running on stdio");
