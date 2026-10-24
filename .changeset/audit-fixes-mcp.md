---
"@veriworkly/ats-engine-mcp": minor
---

The audit's findings are fixed in the server and the engine it runs (engine 0.21.0).

- A saved job posting page (`job_path` to an HTML file) is read in the reader's child process, under the same 60 s limit as a resume, so a 19 MB page no longer blocks the server.
- A file the reader cannot open reports the reader's own reason ("InvalidPDFException: …"), and a malformed request to the child is answered instead of crashing it.
- **Breaking:** answers for the same file change where the engine now reads better: hidden text in Word styles, PDF layers and HTML style sheets is flagged and kept out of the match, the contact line and link paths add no keywords, bulleted role headers and LinkedIn certification rows are read, and a report says when a resume or a posting's requirements were cut.
