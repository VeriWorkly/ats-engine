---
"@veriworkly/ats-engine-mcp": minor
---

**Breaking:** the server's results change for the same file. 0.3.4 already ran engine 0.7 (as 0.3.2 and 0.3.3 ran engines 0.5 and 0.6), which changes the score and the fields read for the same file, and was released as a patch; this release runs the engine's reading fixes, which change them again.

- `check_resume` reads role headers, headings and names that engine 0.4 read right and later versions read wrong: an employer with its state's code ("Analyst at Deloitte, NY", "Software Engineer, Google, CA"), a list of projects or skills under a role ("KEY PROJECTS", "TECH STACK"), the name over its email under a list heading, "Education" set unlike the page's other headings, a role's duration between its header and its dates, and an employer and its city beside the dates over a title. Its `parsed` fields and readiness score, and `match_job`'s job match, change for such files.
