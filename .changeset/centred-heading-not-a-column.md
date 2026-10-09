---
"@veriworkly/ats-engine": patch
---

Fixes a regression in 0.2.0's PDF reading order. A centred heading over a block of short lines, such as "SKILLS" over "Languages: …" on the last page of a resume, was read as a second column and placed after its lines, so the parser found an empty Skills section. Two sides of a page now count as columns only when they sit beside each other: at least half the thinner side's text must lie between the other side's first and last lines. Released as a patch because it restores what 0.2.0 was meant to read; the recovered skills, and the scores that depend on them, change for such files.
