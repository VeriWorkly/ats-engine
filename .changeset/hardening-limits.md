---
"@veriworkly/ats-engine": patch
---

Tighter limits on what a file or a resume can cost, and on what the AI analysis sends. Scores and recovered fields are the same for every resume a person would upload.

- **`readJobFile` reads a posting only from a `.txt`, `.md`, `.html` (`.htm`), `.pdf` or `.docx` file**, and refuses any other with `AtsFileError` before opening it, as `readResumeFile` refuses an unknown resume type. A posting's words come back as missing keywords, so a credentials file or a key named as the posting (`ats-engine check --job`, the MCP server's `job_path`) was echoed back. A JSON file that does not parse is refused as "not valid JSON" without the parser's message, which quoted the file's text.
- **PDF reading stops after the first 100 pages** as well as at the character cap: 5,000 empty pages held extraction for 11 seconds and 50,000 for nine minutes; they now take about half a second and two and a half. `pageCount` still counts every page.
- **A text file's bytes that are not UTF-8 are decoded in one pass**: 20 MB of them took 37 seconds and now take under one. The text is the same for every input.
- **A DOCX's page headers and footers share one 2 MB budget**, in name order; a part past it is neither read into the text nor measured. Each was read up to 8 MB, as many as the archive held: seven of 7.5 MB from a 163 KB file took nine seconds, now under half of one.
- **`analyze` redacts more phone numbers and two-character names.** Any run of 9 to 15 digits on one line that opens with `+` or a trunk `0` (`07912 345678`, `020 7946 0958`, `(02) 9876 5432`) is replaced whether the parser read it or not, so a local number is redacted under a policy without its country's region; a month and its year (`01/2020 - 12/2023`) are not. So is a second North American number (`Home: (415) 555-0199`, `415-555-0199`). Each gets its own placeholder (`[PHONE_1]`, `[PHONE_2]`), restored in the reply. A name of two Chinese or Korean characters (`李明`) is replaced too. Still sent: a number with none of these shapes, such as India's `98765 43210` unless its region pack is attached, which the README's AI sample now does.
