---
"@veriworkly/ats-engine": minor
---

The requirements table judges the seniority a posting's title asks for.

- **Breaking:** a posting whose first line is a title naming a level ("Senior Backend Engineer", "Staff Software Engineer", "Junior Developer") gets a new first row with `kind: "seniority"`. The resume's latest title and its years judge it:
  - **met** by a latest title at or above the level with at least half the years the level takes, or by those years alone when the title names no level;
  - **partial** with the title alone (under half the years), or with a lower title and the years;
  - **missing** otherwise.
  - `detail` says what was compared: "Latest title senior, 10 years in the work history; staff asked (8+ years)". Of several current roles, the highest level counts. An entry level takes no years, so a resume without dated roles meets it.
- A posting gets no row, and its table is unchanged, when its first line names no level, is a sentence or longer than eight words, or names no job title word (an employer's name, "Principal Health Partners"). A level named in a requirement ("work with senior stakeholders") is not read. No score changes: the job match does not read the table.
- **Breaking:** the policy has a new `keywordMatch.requirements.seniorityLevels`, lowest first, each a `name`, the `years` it takes and title `patterns`. The default ladder: entry (intern, trainee, apprentice, graduate, junior; 0 years), mid (mid-level, intermediate; 2), senior (senior, sr; 5), lead (lead, principal, and staff before an engineering or science noun; 8). "Staff Accountant", "Staff Nurse", "Senior Living" and "Lead Generation" name no level, and manager and director titles are a ladder of their own. The default policy's fingerprint changes.
- A language pack adds title words to a level by name (`requirements.seniorityLevels`): German adds Praktikant, Werkstudent, Auszubildende and Berufseinsteiger (entry); French adds stagiaire, alternant and débutant (entry), and confirmé and expérimenté (senior).
