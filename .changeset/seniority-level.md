---
"@veriworkly/ats-engine": minor
---

The requirements table judges the seniority a posting's title asks for.

- **Breaking:** a posting whose first line is a title naming a level ("Senior Backend Engineer", "Staff Engineer", "Junior Developer") gets a new first row with `kind: "seniority"`. The resume's latest title and its years judge it:
  - **met** by a latest title at or above the level, or by the years the level takes when the title names no level;
  - **partial** with a lower title and those years;
  - **missing** otherwise.
  - `detail` says what was compared: "Latest title senior, 10 years in the work history; staff asked (8+ years)". A posting whose title names no level, or whose first line is a sentence or longer than eight words, gets no row, so its table is unchanged. A level named in a requirement ("work with senior stakeholders") is not read. No score changes: the job match does not read the table.
- **Breaking:** the policy has a new `keywordMatch.requirements.seniorityLevels`, lowest first, each a `name`, the `years` it takes and title `patterns`. The default ladder: entry (intern, trainee, apprentice, graduate, junior; 0 years), mid (mid-level, intermediate; 2), senior (senior, sr; 5), lead (lead, staff, principal; 8). "Lead Generation" names no level, and manager and director titles are a ladder of their own. The default policy's fingerprint changes.
- A language pack adds title words to a level by name (`requirements.seniorityLevels`): German adds Praktikant, Werkstudent, Auszubildende and Berufseinsteiger (entry); French adds stagiaire, alternant and débutant (entry), and confirmé and expérimenté (senior).
