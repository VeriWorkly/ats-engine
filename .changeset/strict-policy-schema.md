---
"@veriworkly/ats-engine": patch
---

`policy.schema.json` is strict: an editor now flags a misspelt key in a policy file, such as `rulez` at the top or `wieght` in a rule, which `parseAtsPolicy` drops without a word. Every object with a fixed set of keys allows no other key. Maps keep any key: `synonyms`, `implies`, `numberWords`, advice `targets`, month and season names, language levels and names, and a region's `rules`. `$schema` stays allowed at the top. `parseAtsPolicy` is unchanged: it still drops unknown keys.
