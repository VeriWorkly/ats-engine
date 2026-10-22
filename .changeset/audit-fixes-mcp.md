---
"@veriworkly/ats-engine-mcp": minor
---

- The server reads as many files at once as the computer has CPU cores; further calls wait their turn. 150 calls at once started 150 reading processes and 7.3 GB. A cancelled call now stops the process reading its file, and a call cancelled while it waits never starts one.

- **Breaking:** `check_resume` no longer fails the hidden-text check, and returns a higher score, for a PDF with dark text in a square-cornered bordered box or a tinted band.
- **Breaking:** `check_resume` keeps a current role dated "Till now", "onwards", "Continuing", "06/21 - Present", "bis heute", "ab 03/2020", "मार्च 2020 से" or "अभी तक", which it dropped, and the experience and score it returns change with it.
- **Breaking:** `check_resume` reads a resume whose lines end in a lone carriage return, a vertical tab or a Unicode line separator line by line, which it read as one line, and returns a different score.
- **Breaking:** `check_resume` and `match_job` no longer meet a right-to-work requirement with a statement about another country ("Authorized to work in the US" for a UK role), read "Must be a British citizen" as a citizenship requirement, and meet a citizenship requirement only with that country's citizenship (an Irish citizen may work in the UK and the EU, but is no U.S. or British citizen).
- **Breaking:** a language requirement with a fluent level is missing, not met, by "currently learning", "school level" or "Schulkenntnisse".
- **Breaking:** a clearance stated beside a negation about something else ("Active TS/SCI clearance, no lapses since 2015") meets a clearance requirement, which it did not.
- **Breaking:** an expired, future-dated or in-progress certification is partial, not met, for any requirement naming it ("Active CISSP", "CISSP required"), and says why; a renewal listed after it meets.
- **Breaking:** "Reacted", "Sparked", "rusted" and "R&D" no longer meet React, Spark, Rust and R, in the requirements and the job match score.
- **Breaking:** a right-to-left Word resume no longer fails the invisible-characters check for the direction embeddings Word writes, and scores 10 points higher.
- **Breaking:** a JSON Resume whose current role ends in "heute", "Current role" or another open end the engine reads, written alone, is current, with its full experience, not one month.
- **Breaking:** `check_resume` reads the text of a Chinese, Japanese or Korean PDF whose font uses a standard CJK character map, which came out empty.
- **Breaking:** `check_resume` and `match_job` read `job_text` and `job_path` to 20,000 characters instead of 12,000, so job match scores change for postings over 12,000 characters (a 12,681-character posting with its requirements last: 36 → 4). Past 20,000, `check_resume`'s `parsingWarnings` notes the cut.
- **Breaking:** requirements follow the engine: "or related field" no longer stands in for a degree, and German "-kenntnisse" compounds and the language the resume's sentences are written in (at C1, when no languages are listed) count for a language requirement.
- **Breaking:** `check_resume` reads a name followed by a title on the first line ("Mira Kestrel | Senior Software Engineer") when one email or profile link spells every word of it (mira.kestrel@…, mkestrel@…, linkedin.com/in/mira-kestrel), a school from a tab-separated education line, and a JSON Resume with empty entries first, no `basics`, or `work` as one object, and its score changes with them.
- **Breaking:** `check_resume` finds hidden text in a PDF clipped out of view, drawn in a blend mode that leaves the page unchanged, or set on a blank image of its own colour, and scores such a file lower.
- **Breaking:** `check_resume` measures a PDF's annotations for hidden text: a white box drawn over text is hidden text, and a highlight is not.
- On Linux and macOS, `path` and `job_path` starting with `//` are read.
