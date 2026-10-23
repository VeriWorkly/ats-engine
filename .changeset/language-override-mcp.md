---
"@veriworkly/ats-engine-mcp": minor
---

Choose the language a resume is read in, and acronyms no longer make English read as another language.

- `check_resume` and `match_job` take `language` (`en`, `de`, `fr` or `hi`, any case; `en` reads English only). Without it the language is detected from the resume and the posting, as before. It sets the language of both, so it is for a resume read in the wrong language. An unknown code is refused with the list.
- **Breaking:** with engine 0.19.0, a word in capitals among lower-case words ("MIT" in "BSc, MIT, 2016", "AB" in "Volvo AB") no longer counts as evidence of a language. An English resume with a few such acronyms was read with the German pack attached; it now reads as English. German, French and Hindi resumes and postings, headings in capitals included, read as before.
