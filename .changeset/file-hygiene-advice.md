---
"@veriworkly/ats-engine": minor
"@veriworkly/ats-engine-mcp": minor
---

**Breaking:** the report gains `advice`, a list of notes that are never scored. The report's shape, the policy schema and the policy fingerprint change. Scores do not: the same resume scores byte for byte the same with or without anything that produces advice.

- `report.advice`: always present, often empty. Each item is `{ id, kind: "file" | "age" | "ats", message, evidence?, fix?, source? }`, with its text taken from the policy. It is never part of `readinessScore`, `categories`, `failedChecks` or `prioritizedFixes`.
- File advice, only when the caller describes the file with the new `file` option (`{ name?, bytes?, format?, passwordProtected?, trackedChanges?, comments? }`):
  - `file.name`: a name that says nothing about whose resume it is ("resume.pdf", "CV.docx", "Document1.docx", "scan0001.pdf") or reads as a draft ("Resume_final_v3 (2).pdf"). It suggests `Firstname-Lastname-Resume.pdf` built from the parsed name. A name with a word the lists do not know, in any script, is left alone.
  - `file.size`: over 2 MB, described as a common upload limit rather than a universal one.
  - `file.passwordProtected`: from the caller, or from a PDF that is encrypted but opened without a password.
  - `file.trackedChanges` and `file.comments`: for a Word document still holding them, with their counts.
- Age advice, only where the region pack sets `ageAdvice` (the US: 20 and 20; not Germany or India, where an age on a resume is customary). `age.graduationYear` covers a graduation year more than 20 years back. `age.experienceYears` covers "30+ years of experience" or a work history dated across more than 20 years.
- Target-ATS notes: the new `targetAts` option (`greenhouse`, `lever`, `taleo` in the community policy) adds what that vendor documents on a public page, each note with that page as `source`. An id the policy has no notes on throws `AtsPolicyError`.
- Layout signals: `encrypted` (PDF), and `trackedChanges` and `comments` (DOCX, counted while the document is measured).
- `readResumeFile` also returns `file` (`name`, `bytes`, `format`) to pass to `check`.
- Policy: a new `advice` section (file-name word lists, size limit, age thresholds and patterns, target notes, every message), with defaults so an older policy still parses. Region packs take `ageAdvice` (`graduationYears`, `experienceYears`).
- `shapeReport`: a restricted report gains `advice` with each item's `id`, `kind` and `message` only.
- `/format` adds `adviceLabel` and `ADVICE_LABELS`.
- CLI: an "Advice (not scored)" section after the failed checks, `--ats <name>`, and `advice` in `--json`.
- MCP: `check_resume` takes `target_ats` and returns `advice`, structured and in its text.
