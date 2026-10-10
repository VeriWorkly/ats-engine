# @veriworkly/ats-engine-mcp

## 0.3.0

### Minor Changes

- 6542c45: **Breaking:** Node 22.12 or later is required (`engines.node` is `>=22.12`). Node 20 reached end of life on 2026-04-30 and gets no security fixes; 22.12 is the first Node 22 that loads an ES module through `require()` without a flag, which the CommonJS path in the README relies on. CI now runs on Node 22.12, 24 and 26. Nothing in the engine's behaviour changes. The package descriptions and keywords are rewritten so npm search finds them by the words people type ("ats checker", "resume parser", "resume score", "mcp server").

### Patch Changes

- Updated dependencies [6542c45]
  - @veriworkly/ats-engine@0.4.0

## 0.2.0

### Minor Changes

- 18f77de: **Breaking:** the server runs engine 0.3, so scores and results change for the same file: the readiness score now weighs the writing-style rules (a `writing` entry in `categories`), soft skills weigh less in the job match, and certifications and spoken languages are read as rows of their own.

  - `check_resume` takes `target_ats` (`greenhouse`, `lever` or `taleo`) to add what that vendor documents publicly, each note with a link to its page. An unknown name is a tool error.
  - `check_resume` returns `advice`, never scored, in its structured result and under "Advice (not scored)" in its text: the file's name and size, a password, tracked changes or comments left in a Word document, details that can invite age bias where the region calls for it, and the `target_ats` notes.
  - `match_job` returns `missingKeywordGroups`, and `check_resume`'s `job` returns `matchedKeywordGroups` and `missingKeywordGroups` (`{ hard, soft }`). Both texts print missing soft skills on a line of their own ("Missing soft skills (weigh less): …") under the missing keywords, which now list only hard skills.
  - `check_resume`'s structured `parsed` carries `certifications` and `spokenLanguages` with the rest of what an ATS stores, declared in its output schema, and its text lists them under "What an ATS reads" ("Certification: …", "Speaks: …").

### Patch Changes

- Updated dependencies [b5a7c35]
- Updated dependencies [05c6155]
- Updated dependencies [7d87fbe]
- Updated dependencies [8ba9767]
- Updated dependencies [1998fc2]
- Updated dependencies [1f025ac]
- Updated dependencies [ecee416]
  - @veriworkly/ats-engine@0.3.0

## 0.1.0

### Minor Changes

- a3dd3ef: First release of the MCP server: `npx -y @veriworkly/ats-engine-mcp` lets an AI assistant check your own resume over stdio. Its tools are `check_resume`, `match_job`, `explain_rule` and `extract_text`, and the resource `rubric://default` holds the rubric. Each tool returns text plus structured JSON. The score is the published rubric's, the server makes no network requests and calls no model, and it reads only the files you name.

### Patch Changes

- Updated dependencies [88a9a26]
- Updated dependencies [89a4e55]
- Updated dependencies [88a9a26]
- Updated dependencies [88a9a26]
- Updated dependencies [88a9a26]
- Updated dependencies [88a9a26]
- Updated dependencies [18a5bc6]
- Updated dependencies [3509787]
- Updated dependencies [88a9a26]
- Updated dependencies [a3dd3ef]
- Updated dependencies [0a2a023]
- Updated dependencies [88a9a26]
  - @veriworkly/ats-engine@0.2.0
