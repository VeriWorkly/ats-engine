---
"@veriworkly/ats-engine": minor
---

**Breaking:** the parser recovers fields it used to miss or misread, so recovered fields and scores change for the same input.

- Roles under "Internship", "Clinical Experience", "Research Experience", "Academic Appointments", "Career History" and similar headings are read, and an Education section ends at an unknown heading instead of swallowing the roles after it. Skills under "Key Skills", "Core Competencies" and "Areas of Expertise" are read, education under "Academic Background" or "Educational Qualifications", and "Licenses and Certifications" is its own section. A heading with more words ("Education & Certifications", "Experience & Leadership") is still a heading.
- Job titles that start with a heading word ("Education Officer", "Experience Designer") are no longer taken for headings.
- More date spellings: "2019–21", "Jan '20", "Spring 2020 – Fall 2021", "Summer 2018" (on its own, never over a full range on the same line), "2020 – Today", "Jan2020", a date range wrapped onto two lines, and dates written above the title. A LinkedIn duration ("· 4 yrs 9 mos") no longer becomes the title or employer.
- An employer written once above several titles is kept for each of them (never a city line), and a wrapped title or employer keeps its last line ("…School of Public Health").
- The name is found on a combined contact line ("Jane Doe | jane@… | 415…") and after a "Name:" label, and a heading such as "CONTACT" is never taken for it.
- When a sidebar is read first, the name is taken from above the headline ("LUCAS MOREAU" over "Senior Product Designer"), never from a city with its state or region code ("San Francisco, CA", "Pune, MH") or from under the Experience heading; a name with letters after it ("Priya Raman, MBA") is kept. A letter-spaced name whose word gap was lost ("JANEDOE") is split where the email splits the same letters ("jane.doe@…"). A role row whose title and dates both wrap onto a second line is rejoined.
- Skills in brackets stay together ("AWS (EC2, S3, Lambda)"); more profile links are recognised (Dribbble, Behance, ORCID, GitLab, Kaggle, Google Scholar, `.dev` sites).
- Education: the fallback no longer reads experience bullets, a degree keeps its own school, and BBA, BFA, B.Ed., LLB, J.D., M.D., M.Ed., M.F.A. and LL.M. have levels. India: SSLC, PUC and undotted BE. "LLM" in tech prose ("experience with LLM, RAG") and "J. D. Salinger" are not law degrees. Germany: Dr.-Ing., Gesellenbrief, and a Diplom (BA) at bachelor level.
- "A born leader" no longer counts as a stated date of birth.
- Policy schema: new `resumeParse.seasons`, `durationUnits`, `nameLabels`, `postNominals`, `regionCodes` and `workplaceWords`, which locale packs can extend (the India pack adds its state codes); "today" joins `openEnded`.
