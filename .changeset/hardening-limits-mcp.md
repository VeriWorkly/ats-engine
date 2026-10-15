---
"@veriworkly/ats-engine-mcp": minor
---

**Breaking:** the engine no longer decodes or counts a PDF image past 50 megapixels, so such a file can score differently; a 48 MP photo and a 600 dpi scan are under the cap. A file with one 144 MP image used 1.8 GB and now under 100 MB; six pages with a 48 MP photo each, 2.3 GB and now under 0.5 GB; nothing is left decoding after a file has been read.

`job_path` must name a `.txt`, `.md`, `.html` (`.htm`), `.pdf` or `.docx` file; any other is refused with a tool error before it is opened. A posting's words come back as missing keywords, so a credentials file named as the posting was echoed to the assistant. PDF reading stops after 100 pages, and a DOCX's headers and footers share one 2 MB budget, so a padded file costs what a resume does.
