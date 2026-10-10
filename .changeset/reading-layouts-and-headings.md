---
"@veriworkly/ats-engine": minor
---

**Breaking:** more page layouts, headings and role headers are read right, so recovered fields and scores change for the same input.

- **A heading in the left gutter**, printed level with the first line of its section (a moderncv-style page: "EXPERIENCE⇥Senior Software Engineer, Acme Corp⇥Jan 2020 - Present"), opens its section, and the rest of the line is that section's first line. The heading was read as part of the role ("Senior Software Engineer" at "EXPERIENCE, Acme Corp"), the degree beside "EDUCATION" as a job, the skills were lost, and the structure rules found no headings. Inside Skills, a languages or certifications heading in the gutter is still a category of skills, as one with a colon is.
