---
"@veriworkly/ats-engine-mcp": minor
---

**Breaking:** the server's results change for the same file. 0.3.4 already ran engine 0.7 (as 0.3.2 and 0.3.3 ran engines 0.5 and 0.6), which changes the score and the fields read for the same file, and was released as a patch; this release runs the engine's reading, matching and integrity fixes, which change them again.

- `check_resume` reads role headers, headings and names that engine 0.4 read right and later versions read wrong: an employer after "at" or in a part of its own beside a state's code ("Analyst at Deloitte, NY", "Engineer | Intel | OR"), a list of projects or skills under a role ("KEY PROJECTS", "TECH STACK"), the name over its email under a list heading, "Education" set unlike the page's other headings, a role's duration between its header and its dates, and an employer and its city beside the dates over a title. Its `parsed` fields and readiness score, and `match_job`'s job match, change for such files.
- `match_job` and `check_resume`'s `job` judge requirements and keywords anew: a posting that offers sponsorship no longer marks a candidate who needs it missing, a clearance's level is read beside the clearance and the UK's levels (BPSS, CTC, SC, DV) are compared, a negation about something else no longer drops a statement of the right to work or a clearance, a web address without its scheme is no keyword, and "S/4HANA", "z/OS" and "Pub/Sub" are one keyword each.
- `check_resume`'s integrity rules flag keyword stuffing under a Publications heading on lines with only a year, and a quoted screener prompt of several instructions, or naming "my resume", after a word saying it was caught.
