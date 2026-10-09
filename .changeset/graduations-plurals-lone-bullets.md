---
"@veriworkly/ats-engine": minor
---

**Breaking:** three readings that dropped information are fixed, so recovered fields and scores change for the same input.

- An expected graduation written with a two-digit end year ("B.Tech, IIT Delhi, 2023–27") ends in 2027, not 2023. A degree's short end year may run up to six years past today; a role's still may not, so "2019 - 45" in a bullet stays a number.
- Greek plurals meet their singular in job matching: "analyses" counts for "analysis", as do "hypotheses", "syntheses" and "diagnoses". New stemming rules in the policy (`-ysis`/`-yses`, `-thesis`/`-theses`, `-gnosis`/`-gnoses`) do it; "response" and "responses", "close" and "closes" match as before.
- In a PDF, a list marker drawn as a shape in front of the only bullet of a role now reads as "•". A lone mark still stays a mark before a short line, and wherever marks at the same place stand beside short lines on the page, as a timeline's do.
