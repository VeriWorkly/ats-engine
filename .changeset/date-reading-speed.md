---
"@veriworkly/ats-engine": patch
---

A resume of many short lines is read up to ten times faster. Each line's dates are now looked for once per `check` (and per `parseResume`), not once by each reader of the line, and a line without two digits in a row, which holds no date, is not searched at all. 50 KB of "1" on 25,000 lines took 1.4 to 3 seconds to check, as name, bullet and posting at once with every locale pack; it now takes about 150 ms. Reports are unchanged.
