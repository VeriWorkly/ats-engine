---
"@veriworkly/ats-engine": minor
---

Keyword stuffing is caught when a line names a few skills again and again, each under five times.

- **Breaking:** the readiness score drops for a resume with such a line. "Keywords: Python Kubernetes AWS Docker Go Kafka", written four times on one line, passed the keyword-stuffing check, because each term made up only 16% of the line. The check now also counts the terms of a line together: terms named three times or more each, totalling 10 words or more and half the line, are stuffing. That resume now fails the check: with the default policy, a sales manager's resume with the line added falls from 92 to 82, where it had scored the same as without it.
  - A list split by commas, pipes or semicolons is judged as before, and so is a skills line that names each term once. No other resume among the 3,945 in the tests and the benchmark changes its result.
  - The job match is unchanged: the terms are on the page, and naming them once gives the same match.
