---
"@veriworkly/ats-engine": patch
---

Smaller bundles. The schemas are written with `zod/mini`, which tree-shakes, so the main entry is 91.7 KB gzipped where it was 171.9, and `/locales` and `/ai` are 67.5 KB where they were 141. Parsed policies, defaults, error messages (`AtsPolicyError`, `AtsInputError`, `AtsAiError`), the locale packs' JSON Schemas and the published types are the same, and so is every report.

Two things outside those guarantees change. The raw validation error attached as `AtsAiError.cause` is now zod's core error class (`$ZodError`), with the same issues and message but without `ZodError`'s `format()` and `flatten()` helpers; read `cause.issues` instead. And loading the engine no longer switches zod's global error messages to English: the engine passes English messages to its own parses, so its errors read as before, but a host that relied on that side effect for its own `zod/mini` schemas should call `z.config(z.locales.en())` itself.
