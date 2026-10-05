---
"@veriworkly/ats-engine": patch
---

Fix `repairParse` with structured outputs off (the default): the default prompt never named the fields to return, so a model had to guess them, and a wrong guess came back as an empty repair without an error. The prompt now spells out the shape, including how dates are written.

The default `analyze` and `convertResume` prompts are tighter as well. `analyze` now treats the report's scores as final, leaves redacted contact placeholders alone instead of calling them missing, puts integrity problems first, and states the length limits the output is checked against. `convertResume` says how to fill `basics.role`, links and skill groups, and keeps the resume's language. Results that record `promptVersion` will show new `default:` hashes.
