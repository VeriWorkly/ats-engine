---
"@veriworkly/ats-engine-mcp": minor
---

A resume in a language the engine has no pack for now says so.

- **Breaking:** `check_resume`'s `locale` gains `unsupported` (`"it"`, `"Cyrillic"`, or `null`), and its text answer a "Language:" line: "This resume looks Italian, which the engine does not read yet: …". Scores do not change.
