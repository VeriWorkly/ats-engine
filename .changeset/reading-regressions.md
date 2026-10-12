---
"@veriworkly/ats-engine": minor
---

**Breaking:** role headers, headings and names that 0.4.0 read right and later versions read wrong are read right again, so recovered fields and scores change for the same resume.

- **An employer with its state's code keeps its employer and its title.** "Analyst at Deloitte, NY" beside its dates was read with no title and no employer; "Software Engineer, Google, CA", "Engineer | Intel | OR", "Data Analyst, Capital One, VA" and "Software Engineer" over "Google, CA" had no employer. A city of one or two words and a state's code is still where a role is worked, but not after "at" or "@" ("Analyst at Deloitte, NY" is at Deloitte), nor when a bar parts the code from it ("Engineer | Intel | OR" is at Intel). With commas only, or on a line of its own under a title, "Google, CA" is not told from "Austin, TX": when no other line names the employer (an employer line over the roles, or the role's own), its first part is the employer, as "Infosys, India"'s is. So "Senior Engineer, Austin, TX", which had no employer, is now at "Austin". After a bar or a dash ("Senior Engineer | Austin, TX") it is still where, and a line with a job title and a state's code ("Software Engineer, TX") is no longer taken for a place, which left the role with no title.
