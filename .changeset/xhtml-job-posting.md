---
"@veriworkly/ats-engine": patch
---

`readJobFile`, and so the CLI's `--job` and the MCP server's job path, reads a posting saved as `.xhtml` as a web page, as `readResumeFile` reads a resume. It was refused as an unsupported type.
