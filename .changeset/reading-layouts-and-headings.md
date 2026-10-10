---
"@veriworkly/ats-engine": minor
---

**Breaking:** more page layouts, headings and role headers are read right, so recovered fields and scores change for the same input.

- **A heading in the left gutter**, printed level with the first line of its section (a moderncv-style page: "EXPERIENCE⇥Senior Software Engineer, Acme Corp⇥Jan 2020 - Present"), opens its section, and the rest of the line is that section's first line. The heading was read as part of the role ("Senior Software Engineer" at "EXPERIENCE, Acme Corp"), the degree beside "EDUCATION" as a job, the skills were lost, and the structure rules found no headings. Inside Skills, a languages or certifications heading in the gutter is still a category of skills, as one with a colon is.
- **A PDF's running header and footer** are read once, before the text and after it, as a DOCX's are, and its page numbers ("Page 1 of 2") not at all. A line is one when it is among the top or bottom two of a page and printed at the same height on another page, with the same text (a header or footer) or with only its numbers changed (a page number). A later page that opens with the line the first page opens with ("Jordan Ellery - Resume" over the name, on a document whose first page has no header) opens with its header, which is not read either. Left between the pages, they parted a role's title from its dates: "Senior Engineer, Hooli" at the foot of page 1 and its dates at the top of page 2 were read as "Jordan Ellery" at "Resume, jordan.ellery@example.com".
