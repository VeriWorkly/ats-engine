---
"@veriworkly/ats-engine": minor
---

**Breaking:** fewer false alarms in the keyword match and the integrity checks, so missing keywords, requirement terms, job match scores and readiness scores change for the same resume and posting.

- **Soft skills in their common spellings** are soft skills. "Excellent written and verbal communication", "Detail oriented and self-motivated", "critical-thinking", "Team-player with a growth mindset" put "written", "verbal", "detail", "oriented", "self-motivated", "critical-thinking", "team-player", "growth" and "mindset" at the head of the missing hard skills; a posting asking only for those and two skills the resume had scored 49. "written" and "verbal" are now stopwords (the skill is the communication), "detail oriented", "self motivated" and "growth mindset" are soft skills, and "self-motivated", "critical-thinking" and "team-player" fold onto their spaced spellings in `synonyms`.
- **Posting headings** read: "What we're looking for" and "Skills and Qualifications" (and "Skills", "Required Skills") head the required items, "Desired Skills", "Desired Qualifications" and "Nice-to-haves" the preferred ones, and "What we offer" and "We offer" are left out as benefits are. A posting under "What we're looking for" had no requirements at all, and "what", "offer", "health", "insurance", "qualifications" and "desired" were among its missing keywords. Unbulleted lines under a required heading are requirements, as bulleted ones are.
