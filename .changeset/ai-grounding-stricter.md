---
"@veriworkly/ats-engine": minor
---

**Breaking:** what the AI tasks accept from a model is checked more strictly.

- A value may not span a comma, semicolon, pipe or bullet in the source ("Acme Globex" from "Clients: Acme, Globex"), except a company suffix ("Acme, Inc."). One- and two-letter values no longer ground in "R&D" or "go-to-market".
- Parse repair accepts "current" only when the role's own dates say so, reads the resume's language ("heute"), and accepts years written in two digits ("Jan '19"). `convertResume` now holds start and end years to the document and checks "current" the same way, and takes the engine policy like `repairParse`.
- `analyze` drops keyword suggestions when there is no posting, and drops a suggestion sentence that brings in a number or name found in neither the posting nor the resume. It no longer sends the text-as-read lines twice.
- Redaction also catches "Doe, Jane", a name with or without a middle initial, a curly apostrophe, the phone number written with other separators, and web addresses built from the name.
- Replies from reasoning models (`<think>` blocks, a sentence before the JSON, reasoning parts in a content array) are read instead of failing.
- `needsRepair` offers repair above 160 words, the old 120 at the new full word count.
