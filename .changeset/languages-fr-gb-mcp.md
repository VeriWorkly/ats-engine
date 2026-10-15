---
"@veriworkly/ats-engine-mcp": minor
---

**Breaking:** the server's results change for the same file. It runs the engine's French pack and France and United Kingdom regions, and no longer judges a resume in a language with no pack by English rules.

- `check_resume` reads a French CV in French (headings, dates, degrees, spoken languages), and a resume with a UK number (+44, not one placed in Guernsey, Jersey or the Isle of Man) in the UK's conventions: day-first dates ("01/09/2019" is September 2019), UK credentials (GCSE, HND, PGCE) and a stated date of birth weighed as a warning. Its `parsed` fields, `locale` and readiness score change for such files, and `match_job` reads a French posting's sections and requirements.
- A resume in a language with no pack (Spanish, Italian…) no longer gets the English writing checks; its readiness score changes by those rules.
- `region` now also accepts `FR` and `GB`.
