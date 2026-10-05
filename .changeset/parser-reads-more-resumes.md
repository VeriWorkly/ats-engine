---
"@veriworkly/ats-engine": minor
---

**Breaking:** the parser recovers fields it used to miss or misread, so recovered fields and scores change for the same input.

- Roles under "Internship", "Clinical Experience", "Research Experience", "Academic Appointments", "Career History" and similar headings are read, and an Education section ends at an unknown heading instead of swallowing the roles after it. Skills under "Key Skills", "Core Competencies" and "Areas of Expertise" are read.
- Job titles that start with a heading word ("Education Officer", "Experience Designer") are no longer taken for headings.
- More date spellings: "2019–21", "Jan '20", "Spring 2020 – Fall 2021", "Summer 2018", "2020 – Today", "Jan2020", and a date range wrapped onto two lines. A LinkedIn duration ("· 4 yrs 9 mos") no longer becomes the title or employer.
- An employer written once above several titles is kept for each of them.
- The name is found on a combined contact line ("Jane Doe | jane@… | 415…") and after a "Name:" label, and a heading such as "CONTACT" is never taken for it.
- When a sidebar is read first, the name is taken from above the headline ("LUCAS MOREAU" over "Senior Product Designer"), never from a city whose state looks like a credential ("San Francisco, CA") or from under the Experience heading. A role row whose title and dates both wrap onto a second line is rejoined.
- Skills in brackets stay together ("AWS (EC2, S3, Lambda)"); more profile links are recognised (Dribbble, Behance, ORCID, GitLab, Kaggle, Google Scholar, `.dev` sites).
- Education: the fallback no longer reads experience bullets, a degree keeps its own school, and BBA, BFA, B.Ed., LLB, J.D., M.D., M.Ed., M.F.A. and LL.M. have levels. India: SSLC, PUC and undotted BE; "LLM-based" is not an LL.M. Germany: Dr.-Ing., Gesellenbrief, and a Diplom (BA) at bachelor level.
- "A born leader" no longer counts as a stated date of birth.
- Policy schema: new `resumeParse.seasons`, `durationUnits` and `nameLabels`, which locale packs can extend; "today" joins `openEnded`.
