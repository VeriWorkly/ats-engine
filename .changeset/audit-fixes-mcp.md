---
"@veriworkly/ats-engine-mcp": minor
---

- The server reads as many files at once as the computer has CPU cores; further calls wait their turn. 150 calls at once started 150 reading processes and 7.3 GB. A cancelled call now stops the process reading its file, and a call cancelled while it waits never starts one.

- **Breaking:** `check_resume` no longer fails the hidden-text check, and returns a higher score, for a PDF with dark text in a bordered box, a chip or a tinted band.
- **Breaking:** `check_resume` keeps a current role dated "Till now", "onwards", "Continuing", "06/21 - Present", "bis heute", "ab 03/2020", "मार्च 2020 से" or "अभी तक", which it dropped, and the experience and score it returns change with it.
- **Breaking:** `check_resume` reads a resume whose lines end in a lone carriage return, a vertical tab or a Unicode line separator line by line, which it read as one line, and returns a different score.
- **Breaking:** `check_resume` and `match_job` no longer meet a right-to-work requirement with a statement about another country ("Authorized to work in the US" for a UK role), and read "Must be a British citizen" as a citizenship requirement.
- **Breaking:** a language requirement with a level is partial, not met, by a spoken language whose level the engine cannot read, and missing by "currently learning" or "Schulkenntnisse".
- **Breaking:** a clearance stated beside a negation about something else ("Active TS/SCI clearance, no lapses since 2015") meets a clearance requirement, which it did not.
- **Breaking:** an expired, future-dated or in-progress certification is partial, not met, for a certification requirement, and says why.
- **Breaking:** "Reacted", "Sparked", "rusted" and "R&D" no longer meet React, Spark, Rust and R, in the requirements and the job match score.
- **Breaking:** a right-to-left Word resume no longer fails the invisible-characters check for the direction embeddings Word writes, and scores 10 points higher.
- **Breaking:** a JSON Resume whose current role ends in "heute", "Current role" or another open end the engine reads is current, with its full experience, not one month.
- **Breaking:** `check_resume` reads the text of a Chinese, Japanese or Korean PDF whose font uses a standard CJK character map, which came out empty.
