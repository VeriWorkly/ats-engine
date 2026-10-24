---
"@veriworkly/ats-engine-mcp": minor
---

Mexico, Argentina, Colombia and Chile are read as their own regions (engine 0.21.0).

- `region` accepts `MX`, `AR`, `CO` and `CL`. Without it, a Spanish or Portuguese resume's region also comes from its header (an email's country domain, the country's name or one of its cities) when its phone has no country code.
- **Breaking:** answers for the same file change where the engine now reads it better: an honorific is left out of the name ("Dr. Miriam Hoffmann" reads "Miriam Hoffmann"), every Spanish role is read "Cargo en Empresa" once one role shows it, a city beside the dates under a stacked header is where, and a PDF's flush-right city over its dates is no longer a second column. On the reviewer's resumes, German, Hindi, Spanish and Portuguese go from 99.2–99.3% of fields right to 100%, and every pack is corrected by a linguist's review.
