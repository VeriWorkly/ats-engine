---
"@veriworkly/ats-engine-mcp": minor
---

- **Breaking:** `match_job` reads hidden text as the engine now does: a visible skill that a Word header's hidden run or a web page's hidden element repeats is no longer set aside, and white text drawn after visible text on one line of a PDF or Word file no longer counts. Its result changes for such a file.
- A `job_path` saved as UTF-16 or Windows-1252, or with a byte-order mark, is read; before, a UTF-16 posting matched nothing.
- `extract_text` no longer repeats the hidden text in its layout: `hiddenTextRead`, which on a PDF is the same 5,000 characters as `hiddenText`, is left out.
