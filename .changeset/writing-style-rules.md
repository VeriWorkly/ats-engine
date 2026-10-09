---
"@veriworkly/ats-engine": minor
---

**Breaking:** the community policy gains eight writing-style rules in a new `writing` category, so the readiness score and `categories` change for the same input. The scores of the existing categories do not move; the total does, because it now weighs `writing` too (12 points of weight, against 190 for the rest of the rubric).

- `ats-v2.writing.firstPerson`, `passiveVoice`, `weakOpeners`, `tense`, `bulletLength`, `bulletsPerRole`, `repeatedOpeners` and `dateFormats` flag bullets in the first person or the passive voice, bullets that open with a duty ("Responsible for"), a present tense in a role already left (the current role may use either), bullets over 40 words, roles with fewer than 2 or more than 8 bullets, three bullets in a row opening with the same word, and role dates written in more than one format. Each quotes what it found and says how to fix it.
- They are English only and are dropped, not failed, for a resume read in another language, and when there is nothing to judge (no bullets, no dated roles).
- Policy schema: a rule may carry `languages` (ISO 639 codes) and is then dropped for a resume read in any other language; `text.language` (default `"en"`) names the language a resume is read in when no attached language pack recognises it; a new `writing` section holds the word lists and limits, with defaults, so a policy written before it still parses.
- `localizePolicy` also returns `resumeLanguages`: the language packs the resume itself is read in, without one only the posting is written in.
- `/format`: `CATEGORY_ORDER` ends with `writing`, labelled "Writing".
