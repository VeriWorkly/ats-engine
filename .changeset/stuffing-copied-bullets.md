---
"@veriworkly/ats-engine": minor
---

A bullet copied word for word into several roles is no longer read as keyword stuffing.

- **Breaking:** the readiness score rises by the keyword-stuffing deduction (10 points with the default policy) for a resume whose one sentence, such as "Mentored three junior colleagues into their first promotion", appears once under each of three or more roles. The check read it as a line pasted again and again. Of 3,000 generated resumes, 46 (1.5%) carried such a bullet and failed the check; they now pass, and no other result moves.
  - A sentence pasted three times under one role, or outside the roles, is still stuffing, and so is a line of bare terms repeated anywhere.
