---
"@veriworkly/ats-engine-mcp": minor
---

German, French and Hindi resumes read nearly as well as English ones, and Spanish and Portuguese are read too (engine 0.20.0).

- **Breaking:** answers for the same file change where the engine now reads it better. On resumes written in each language, fields read right went from 80.0% to 99.2% in German, 89.8% to 97.6% in French, 88.4% to 99.2% in Hindi, 24.3% to 98.0% in Spanish and 23.3% to 99.3% in Portuguese; a city after the employer is left out of it; English answers change only where a field is read better.
- `language` accepts `es` and `pt`, and `region` accepts `ES`, `BR` and `PT`.
