---
"@veriworkly/ats-engine-mcp": minor
---

**Breaking:** the server runs engine 0.3, so scores and results change for the same file: the readiness score now weighs the writing-style rules (a `writing` entry in `categories`), soft skills weigh less in the job match, and certifications and spoken languages are read as rows of their own.

- `check_resume` takes `target_ats` (`greenhouse`, `lever` or `taleo`) to add what that vendor documents publicly, each note with a link to its page. An unknown name is a tool error.
- `check_resume` returns `advice`, never scored, in its structured result and under "Advice (not scored)" in its text: the file's name and size, a password, tracked changes or comments left in a Word document, details that can invite age bias where the region calls for it, and the `target_ats` notes.
- `match_job` returns `missingKeywordGroups`, and `check_resume`'s `job` returns `matchedKeywordGroups` and `missingKeywordGroups` (`{ hard, soft }`). Both texts print missing soft skills on a line of their own ("Missing soft skills (weigh less): …") under the missing keywords, which now list only hard skills.
- `check_resume`'s structured `parsed` carries `certifications` and `spokenLanguages` with the rest of what an ATS stores, declared in its output schema, and its text lists them under "What an ATS reads" ("Certification: …", "Speaks: …").
