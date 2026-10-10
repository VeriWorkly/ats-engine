---
"@veriworkly/ats-engine-mcp": patch
---

The server's MCP Registry name is now `io.github.VeriWorkly/ats-engine` (`mcpName` in package.json and `name` in server.json), in the organisation's own casing. The registry grants a GitHub namespace in the owner's exact casing and compares names case by case, so it refused the lowercase `io.github.veriworkly/ats-engine`. From this version on, each release of the server is listed in the official MCP Registry (registry.modelcontextprotocol.io). Nothing changes in how the server runs or what its tools return.
