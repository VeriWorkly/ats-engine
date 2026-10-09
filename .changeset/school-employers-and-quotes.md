---
"@veriworkly/ats-engine": minor
---

**Breaking:** two readings are corrected, so recovered fields and evidence text change for the same input.

- An employer whose name holds a joining word keeps it: "Teaching Assistant, The University of Texas at Austin" reads the employer as "The University of Texas at Austin", not "The University of Texas, Austin". The joining words ("at", "bei", …) still part a title from its employer everywhere else: "Research Assistant at University of Michigan" is a title and an employer.
- A rule's quoted evidence longer than 80 characters is cut where a word ends and ends in "…", instead of stopping mid-word ("from 52% t").
