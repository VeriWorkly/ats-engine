---
"@veriworkly/ats-engine": minor
---

**Breaking:** job matching and requirement judgements are corrected, so `jobMatchScore`, the keyword lists and `requirements` change for the same input.

- Requirement judging used the clock instead of `now`, so a report could change from one day to the next. It now reads `now` like the rest of the report.
- The posting is normalised like the resume, so a no-break or zero-width space no longer hides a term.
- Required items under "Minimum Qualifications", "Basic Qualifications", "What you bring", "About you", "Your profile" and similar headings are read, and they are no longer dropped when only a "Nice to have" heading is recognised.
- Years for a named skill count only the roles that name it, and years in a field ("software engineering") only the roles that name every word of it, with no fallback to total tenure; roles are found by their own header lines, never by a later employer named in a bullet. An answer that is not "met" always says why in `detail`. "Five (5) years" is read, and "at least 18 years of age" is not a years requirement.
- An activity or a credential stays part of the requirement: "mentoring engineers" is not met by an engineering title, and "AWS certification" is not met by using AWS, but is by a line under a certifications or licences heading. A title such as "Engineering Manager" stays a title. A clause marked "a plus" or "preferred" no longer raises the degree asked for, and a line whose marker opens or closes it ("Ideally, …", "… is a plus") is `importance: "preferred"`.
- Plurals match ("Databases", "APIs", "buses", "statuses"). One- and two-letter skills count only as written ("R", "Go"), so a middle initial or "go the extra mile" no longer matches. Node/NodeJS/Node.js and React/React.js match.
- Text the layout marks as hidden no longer counts toward the match or serves as evidence when the hidden-text check fails, and `jobMatchScore` is held to `readinessScore` when an integrity error fires.
- Salary, benefits and other lines about what a posting offers ("Benefits:", an amount of money) are not judged as requirements or counted as keywords; "compensation analysis experience" still is a requirement.
- `missingKeywords` leaves out locations and addresses, the employer's name (unless a requirement names the same word), filler words, and terms of requirements already met. A language requirement asks for every language it names, and a nationality line is never proof of a language.
- Policy schema: new `keywordMatch.qualifiers`, `preferredMarkers`, `numberWords`, `ignorePatterns`, `offerWords` and `nationalityLabels`; new stemming rules and vocabulary in the default policy.
