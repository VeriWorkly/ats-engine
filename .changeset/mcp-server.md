---
"@veriworkly/ats-engine-mcp": minor
---

First release of the MCP server: `npx -y @veriworkly/ats-engine-mcp` lets an AI assistant check your own resume over stdio. Its tools are `check_resume`, `match_job`, `explain_rule` and `extract_text`, and the resource `rubric://default` holds the rubric. Each tool returns text plus structured JSON. The score is the published rubric's, the server makes no network requests and calls no model, and it reads only the files you name.
