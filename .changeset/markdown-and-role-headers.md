---
"@veriworkly/ats-engine": minor
---

**Breaking:** Markdown resumes and role headers with a location are read correctly, so recovered fields and scores change for the same input.

- A resume written in Markdown is read past its syntax: `# Name` and `## Experience` headings, `**bold**` and `__bold__`, `---` rules and `[text](url)` links. Before, `#` and `*` were taken for list markers, so the name, every section heading and every role were lost.
- Role headers that carry a location are recognised: "Engineer, Acme — San Francisco, CA", "Engineer | Acme | San Francisco, CA" and "Engineer at Acme, San Francisco, CA". The separators were counted as words, which pushed these past the length of a header.
- The employer no longer carries the place after it: "Engineer, Acme, San Francisco, CA" and "Engineer, Acme, Remote" read the employer as "Acme". A city without a state code ("Acme, Berlin") is kept, since it cannot be told from part of the name.
