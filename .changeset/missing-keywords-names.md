---
"@veriworkly/ats-engine": minor
---

**Breaking:** `missingKeywords` no longer lists the employer or the places and product lines a
posting names in passing. "At Freightways, we ship from our Harbor Point depot" used to put
"freightways", "harbor" and "point" ahead of real gaps, ranked as skills. The job-match score
changes with it for the same input, because those words no longer count against the resume.

- New option `jobCompany` on `AtsScoringService.check`: every word of the employer's name is
  left out of the keywords. Pass the `company` that `/job`'s `extractJobPosting` returns; the
  CLI does this for a saved `.html` page.
- A word is also left out when the posting writes it only capitalised mid-sentence, only in its
  prose, never in a list or under a requirements heading, and the policy's vocabulary does not
  know it. Skills the posting lists, writes in lowercase, or the policy names are kept. A posting
  with fewer than three list lines keeps every word.
- Policy schema: new `keywordMatch.proseNames` (`{ enabled: true, minListLines: 3 }` by default)
  switches this off or changes the threshold. It never applies to a language that capitalises
  every noun (`nounsCapitalized`, German). Language packs gain `proseNames: false`, which the
  Hindi pack sets: a Latin word in a Devanagari sentence keeps its capital whatever it is.
- The community policy's fingerprint changes (RUBRIC.md regenerated).
