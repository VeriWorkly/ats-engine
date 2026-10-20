---
"@veriworkly/ats-engine": minor
---

The deprecated API and the old policy shapes are removed.

- **Breaking:** `AtsScoringService` is gone. Call `check(resume, policy?, options?)`, which gives the same report.
- **Breaking:** `level` on `AtsParsedEducation`, `highestDegree` on `AtsParsedResume`, `AtsDegreeLevel` and `DEGREE_LABELS` are gone. Read `isced`, `highestIsced` and `ISCED_LABELS`.
- **Breaking:** a policy's `resumeParse.degrees` is keyed by ISCED level (`"2"` to `"8"`) only. The old `diploma`/`associate`/`bachelor`/`master`/`doctorate` keys are refused.
- **Breaking:** a `position` rule no longer takes `emailPattern` or `phonePattern`. It locates the email address and phone number the parser recovered, as the default policy always has.
- **Breaking:** `AtsLayoutSignals.hiddenTextSample` is gone. `hiddenText` holds all of the hidden text, and the hidden-text rule quotes its first 80 characters.
- A DOCX is unzipped once per read, where it was unzipped up to six times.
- Bundle sizes (gzipped): `.` from 102.9 to 102.6 KB.
