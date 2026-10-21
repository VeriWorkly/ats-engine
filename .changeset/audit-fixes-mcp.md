---
"@veriworkly/ats-engine-mcp": minor
---

- **Breaking:** `check_resume` no longer fails the hidden-text check, and returns a higher score, for a PDF with dark text in a bordered box, a chip or a tinted band.
- **Breaking:** `check_resume` keeps a current role dated "Till now", "onwards", "Continuing", "06/21 - Present", "bis heute", "ab 03/2020", "मार्च 2020 से" or "अभी तक", which it dropped, and the experience and score it returns change with it.
- **Breaking:** `check_resume` reads a resume whose lines end in a lone carriage return, a vertical tab or a Unicode line separator line by line, which it read as one line, and returns a different score.
- **Breaking:** `check_resume` reads the text of a Chinese, Japanese or Korean PDF whose font uses a standard CJK character map, which came out empty.
