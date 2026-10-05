---
"@veriworkly/ats-engine": minor
---

**Breaking:** job matching and requirement judgements are corrected, so `jobMatchScore`, the keyword lists and `requirements` change for the same input.

- Requirement judging used the clock instead of `now`, so a report could change from one day to the next. It now reads `now` like the rest of the report.
- The posting is normalised like the resume, so a no-break or zero-width space no longer hides a term.
- Required items under "Minimum Qualifications", "Basic Qualifications", "What you bring", "About you", "Your profile" and similar headings are read, and they are no longer dropped when only a "Nice to have" heading is recognised.
- Years for a named skill count only the roles that name it, with no fallback to total tenure; an answer that is not "met" always says why in `detail`. "Five (5) years" is read, and "at least 18 years of age" is not a years requirement.
- An activity or a credential stays part of the requirement: "mentoring engineers" is not met by an engineering title, and "AWS certification" is not met by using AWS. A clause marked "a plus" or "preferred" no longer raises the degree asked for, and a line that is optional throughout is `importance: "preferred"`.
- Plurals ending in "es" match ("Databases", "APIs"). One- and two-letter skills count only as written ("R", "Go"), so a middle initial or "go the extra mile" no longer matches. Node/NodeJS/Node.js and React/React.js match.
- Text the layout marks as hidden no longer counts toward the match or serves as evidence, and `jobMatchScore` is held to `readinessScore` when an integrity error fires.
- Salary, benefits and other lines about what a posting offers are not judged as requirements.
- `missingKeywords` leaves out locations, the employer's name, filler words, and terms of requirements already met; a nationality line is never proof of a language.
- Policy schema: new `keywordMatch.qualifiers`, `preferredMarkers`, `numberWords`, `ignorePatterns`, `offerWords` and `nationalityLabels`; new stemming rules and vocabulary in the default policy.
