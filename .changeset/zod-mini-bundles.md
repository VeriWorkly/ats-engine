---
"@veriworkly/ats-engine": patch
---

Smaller bundles: zod/mini; no behaviour change. The schemas are written with `zod/mini`, which tree-shakes, so the main entry is 91.7 KB gzipped where it was 171.9, and `/locales` and `/ai` are 67.5 KB where they were 141. Parsed policies, defaults, error messages (`AtsPolicyError`, `AtsInputError`, `AtsAiError`), the locale packs' JSON Schemas and the published types are the same.
