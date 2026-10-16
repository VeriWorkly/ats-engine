---
"@veriworkly/ats-engine-mcp": minor
---

- **Breaking:** the engine no longer sets aside a visible line as hidden because hidden text repeats it, so a resume with hidden keyword blocks can match a posting differently for the same file.
- A PDF or DOCX is read in its own `/node/child` process, one per file and stopped after 60 seconds: a file that exhausts memory, crashes the parser or never ends takes down that process, not the server. A damaged file is reported with the reader's reason.
