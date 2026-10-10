---
"@veriworkly/ats-engine": minor
---

**Breaking:** roles and names are read right in more layouts, so recovered fields and scores change for the same input.

- **A city and state beside a role's dates** is no longer read as its title or employer. "Senior Engineer | Acme Corp" over "Jan 2020 - Present | Austin, TX" was read as "Austin" at "TX", "Acme Corp | Austin, TX | Jan 2020 - Present" over "Senior Engineer" as "Acme Corp" at "Austin, TX", and "Engineer" / "Amazon" / "Seattle, WA" / "Jan 2020 - Present" as "Seattle" at "WA"; each is now the title at the employer, as are "Acme Corp" / "Senior Engineer" / "Austin, TX | Jan 2020 - Present" and "Acme Corp⇥Jan 2020 - Present" over "Senior Engineer⇥Austin, TX". Where no employer is named, the place is not taken for one: "Senior Engineer" over "Austin, TX", "Senior Engineer, Austin, TX" and a bare "Remote" ("Engineer, Remote", "Engineer" over "Remote") were read with "Austin, TX" or "Remote" as the employer, and now leave it empty. A place is still a city with one of the policy's `regionCodes`, or a `workplaceWords` word; a tab or a wide gap ends a part as a comma does ("Acme Corp⇥Austin, TX" is an employer and its place), and a city of three words or more beside its state, which may be an employer run into its city ("Oakmont Foods Portland, OR"), stays with the employer.
