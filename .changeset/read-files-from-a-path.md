---
"@veriworkly/ats-engine": minor
---

`/node` now exports `readResumeFile(path)` and `readJobFile(path)`, the CLI's file readers, with `AtsFileError` and `MAX_FILE_BYTES`. A missing file, a folder, an unsupported type or a file over 20 MB is refused with a plain message. The CLI and the MCP server share them, so the CLI now refuses a file over 20 MB before reading it. `printable`, which strips terminal control characters from a value at any depth, is exported from `/format`.
