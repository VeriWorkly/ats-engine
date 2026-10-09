---
"@veriworkly/ats-engine": minor
---

**Breaking:** the job match tells hard skills from soft skills ("communication", "teamwork") and weighs soft skills less, so `jobMatchScore` changes for the same input whenever a posting names one, and the report gains two fields.

- `matchedKeywordGroups` and `missingKeywordGroups` (`AtsKeywordGroups`: `{ hard: string[]; soft: string[] }`, each at most 12) list the posting's terms by kind. `matchedKeywords` and `missingKeywords` keep their type and their cap of 12, but their order changes: they are now the hard group followed by the soft one, where a soft skill used to rank among the ordinary words.
- A soft skill weighs `softSkillWeight` (0.4) of an ordinary word, a tenth of a named skill, whatever its capitals: a resume claims it more often than it shows it, and an ATS's keyword match gives it little value. A resume missing only soft skills now scores above one missing as many hard skills.
- Policy schema: `keywordMatch.softSkills` (default empty; the community policy lists 29) and `keywordMatch.softSkillWeight` (default 0.4). A multi-word soft skill is matched as a phrase ("problem solving", "attention to detail"), so a requirement naming one lists it as one term. Soft skills are never recognised hard skills, even when `phrases` or `synonyms` name them. The community policy adds synonyms that fold a soft skill's other spellings ("communicating", "collaborative", "problem-solving") together. Mentoring, coaching, project management and negotiation stay hard skills: a resume shows them with outcomes.
- Language packs: a `softSkills` field, added to the policy's. The German pack lists 32 ("Teamfähigkeit", "Kommunikationsstärke", "belastbar"), the Hindi pack 14 ("संचार", "नेतृत्व", "समस्या समाधान"), and the Hindi pack's stopwords gain "कौशल" and "क्षमता" ("skill", "ability"), as English "skills" and "ability" are.
- The CLI prints missing soft skills on a line of their own ("Missing soft skills (weigh less): …") under the missing keywords, which now list only the hard group.
- A restricted report (`shapeReport(…, "restricted")`) carries no groups; its `missingKeywordCount` counts the flat list.
