---
"@veriworkly/ats-engine": minor
---

A bullet copied word for word into a few roles is no longer read as keyword stuffing.

- **Breaking:** the readiness score rises by the keyword-stuffing deduction (10 points with the default policy) for a resume whose one sentence, such as "Mentored three junior colleagues into their first promotion", appears once under each of three or four roles. The check read it as a line pasted again and again. A sentence is one with a stopword or that opens with an action verb, so a terse bullet ("Mentored junior engineers through weekly pairing sessions") counts too. Of 3,000 generated resumes, 46 (1.5%) carried such a bullet and failed the check; they now pass, and no other result moves.
  - Still stuffing: the same sentence in five roles or more; a sentence pasted three times under one role, or outside the roles; a run of terms ("python kubernetes docker aws") or a list ("python, kubernetes, docker and kafka") repeated anywhere, in lower case too.
