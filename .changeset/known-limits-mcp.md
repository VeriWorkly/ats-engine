---
"@veriworkly/ats-engine-mcp": minor
---

- **Breaking:** `check_resume` no longer counts a parental leave, career break or sabbatical, or a dated sentence that opens with a past-tense verb such as "Analysed 2017 thru 2018 data", as a job, so the experience and seniority it returns are no longer inflated.
- **Breaking:** `check_resume` no longer reads a tagline before a title ("Open Source | Software Engineer") as the name.
- **Breaking:** `check_resume` and `match_job` credit the language a resume is written in over a "Languages" list of programming languages the policy knows ("Python, Go"), in text and in JSON Resume alike.
