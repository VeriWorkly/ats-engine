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
- A word is also left out when the posting writes it as a name: only capitalised mid-sentence,
  only in its prose, never in a list or under a requirements heading, unknown to the policy's
  vocabulary, and beside the signs of a name — in a run of capitalised words ("Harbor Point",
  "Cedar Valley Health") or after "the", "our", "at", "join", "across" or "near". "Written in
  Rust" or "the mobile team uses Swift" shows no such sign, so the skill is kept. Skills the
  posting lists, writes in lowercase, or the policy names are kept too. A posting with fewer
  than three list lines keeps every word.
- Policy schema: new `keywordMatch.proseNames` with `enabled` (default `true`), `minListLines`
  (default 3), `cues` (the words above) and `skills`, about 180 tools and languages spelled like
  ordinary words (Rust, Swift, Spark, Rails, Epic, Excel…) that are never left out, even beside
  a cue ("Apache Spark", "the Rust compiler"). It never applies to a language that capitalises
  every noun (`nounsCapitalized`, German). Language packs gain `proseNames: false`, which the
  Hindi pack sets: a Latin word in a Devanagari sentence keeps its capital whatever it is.
- The community policy's fingerprint changes (RUBRIC.md regenerated).
