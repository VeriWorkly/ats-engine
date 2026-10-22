# @veriworkly/ats-engine-mcp

## 0.11.0

### Minor Changes

- a8cb5dc: - The server reads as many files at once as the computer has CPU cores; further calls wait their turn. 150 calls at once started 150 reading processes and 7.3 GB. A cancelled call now stops the process reading its file, and a call cancelled while it waits never starts one.

  - **Breaking:** `check_resume` no longer fails the hidden-text check, and returns a higher score, for a PDF with dark text in a bordered box, a chip or a tinted band.
  - **Breaking:** `check_resume` keeps a current role dated "Till now", "onwards", "Continuing", "06/21 - Present", "bis heute", "ab 03/2020", "मार्च 2020 से" or "अभी तक", which it dropped, and the experience and score it returns change with it.
  - **Breaking:** `check_resume` reads a resume whose lines end in a lone carriage return, a vertical tab or a Unicode line separator line by line, which it read as one line, and returns a different score.
  - **Breaking:** `check_resume` and `match_job` no longer meet a right-to-work requirement with a statement about another country ("Authorized to work in the US" for a UK role), and read "Must be a British citizen" as a citizenship requirement.
  - **Breaking:** a language requirement with a fluent level is missing, not met, by "currently learning", "school level" or "Schulkenntnisse".
  - **Breaking:** a clearance stated beside a negation about something else ("Active TS/SCI clearance, no lapses since 2015") meets a clearance requirement, which it did not.
  - **Breaking:** an expired, future-dated or in-progress certification is partial, not met, for a certification requirement, and says why.
  - **Breaking:** "Reacted", "Sparked", "rusted" and "R&D" no longer meet React, Spark, Rust and R, in the requirements and the job match score.
  - **Breaking:** a right-to-left Word resume no longer fails the invisible-characters check for the direction embeddings Word writes, and scores 10 points higher.
  - **Breaking:** a JSON Resume whose current role ends in "heute", "Current role" or another open end the engine reads is current, with its full experience, not one month.
  - **Breaking:** `check_resume` reads the text of a Chinese, Japanese or Korean PDF whose font uses a standard CJK character map, which came out empty.

### Patch Changes

- Updated dependencies [a8cb5dc]
  - @veriworkly/ats-engine@0.17.0

## 0.10.0

### Minor Changes

- d939b84: `explain_rule` takes an optional `region` and explains a rule as that country weighs it, as `check_resume` scores it. Without one it gave the published weights only: a photo showed 2 points where a US resume is scored on 6. A rule a region turns off (a photo in Germany) answers that it is not scored there. Without `region`, the answer is unchanged.
- d88dc12: - **Breaking:** `match_job` and `check_resume` with a posting list a new first requirement, `kind: "seniority"`, when the posting's title names a level ("Senior Backend Engineer"), judged by the resume's latest title and years.
- 85765ab: - **Breaking:** `check_resume` no longer fails the keyword-stuffing check, and returns a higher score, for a resume that copies one bullet into three or four roles, once each. In five or more, it is still stuffing.

### Patch Changes

- Updated dependencies [d88dc12]
- Updated dependencies [9cff50a]
- Updated dependencies [85765ab]
- Updated dependencies [d939b84]
  - @veriworkly/ats-engine@0.16.0

## 0.9.0

### Minor Changes

- b20dd84: - **Breaking:** `check_resume` fails the keyword-stuffing check, and returns a lower score, for a resume with a line that names a few skills again and again, each under five times ("Python Kubernetes AWS Docker Go Kafka" written four times).

### Patch Changes

- Updated dependencies [b20dd84]
  - @veriworkly/ats-engine@0.15.0

## 0.8.0

### Minor Changes

- ca0e088: - **Breaking:** runs engine 0.14.0. A parsed resume in `check_resume` no longer carries `highestDegree` or an education row's `level`; read `highestIsced` and `isced`.

### Patch Changes

- Updated dependencies [ca0e088]
  - @veriworkly/ats-engine@0.14.0

## 0.7.0

### Minor Changes

- 97b2671: - **Breaking:** `match_job` reads hidden text as the engine now does: a visible skill that a Word header's hidden run or a web page's hidden element repeats is no longer set aside, and white text drawn after visible text on one line of a PDF or Word file no longer counts. Its result changes for such a file.
  - A `job_path` saved as UTF-16 or Windows-1252, or with a byte-order mark, is read; before, a UTF-16 posting matched nothing.
  - `extract_text` no longer repeats the hidden text in its layout: `hiddenTextRead`, which on a PDF is the same 5,000 characters as `hiddenText`, is left out.

### Patch Changes

- Updated dependencies [97b2671]
  - @veriworkly/ats-engine@0.13.0

## 0.6.0

### Minor Changes

- 0e3eebc: - **Breaking:** the engine no longer sets aside a visible line as hidden because hidden text repeats it, so a resume with hidden keyword blocks can match a posting differently for the same file.
  - A PDF or DOCX is read in its own `/node/child` process, one per file and stopped after 60 seconds: a file that exhausts memory, crashes the parser or never ends takes down that process, not the server. A damaged file is reported with the reader's reason.

### Patch Changes

- Updated dependencies [0e3eebc]
  - @veriworkly/ats-engine@0.12.0

## 0.5.1

### Patch Changes

- 559f57d: The server's homepage and its MCP Registry `websiteUrl` are now its documentation page, [docs.veriworkly.com/ats-engine/tools/mcp](https://docs.veriworkly.com/ats-engine/tools/mcp), with setup for each client, every tool and its inputs. The tools and their results are unchanged.
- Updated dependencies [13ffd6d]
  - @veriworkly/ats-engine@0.11.0

## 0.5.0

### Minor Changes

- ea72dfd: **Breaking:** the server's results change for the same file. It runs the engine's French pack and France and United Kingdom regions, and no longer judges a resume in a language with no pack by English rules.

  - `check_resume` reads a French CV in French (headings, dates, degrees, spoken languages), and a resume with a UK number (+44, not one placed in Guernsey, Jersey or the Isle of Man) in the UK's conventions: day-first dates ("01/09/2019" is September 2019), UK credentials (GCSE, HND, PGCE) and a stated date of birth weighed as a warning. Its `parsed` fields, `locale` and readiness score change for such files, and `match_job` reads a French posting's sections and requirements.
  - A resume in a language with no pack (Spanish, Italian…) no longer gets the English writing checks; its readiness score changes by those rules.
  - `region` now also accepts `FR` and `GB`.

### Patch Changes

- b0c0c7f: `job_path` must name a `.txt`, `.md`, `.html` (`.htm`), `.pdf` or `.docx` file; any other is refused with a tool error before it is opened. A posting's words come back as missing keywords, so a credentials file named as the posting was echoed to the assistant. PDF reading stops after 100 pages, and a DOCX's headers and footers share one 2 MB budget, so a file padded with empty pages or headers costs what a resume does. A PDF's images are decoded a page at a time rather than all after the file has been read; an image still has no size cap, so a file with large images can hold gigabytes and take tens of seconds.
- Updated dependencies [b0c0c7f]
- Updated dependencies [97d2967]
- Updated dependencies [ea72dfd]
  - @veriworkly/ats-engine@0.10.0

## 0.4.1

### Patch Changes

- Updated dependencies [3b17f9a]
  - @veriworkly/ats-engine@0.9.0

## 0.4.0

### Minor Changes

- 5dd6f03: **Breaking:** the server's results change for the same file. 0.3.4 already ran engine 0.7 (as 0.3.2 and 0.3.3 ran engines 0.5 and 0.6), which changes the score and the fields read for the same file, and was released as a patch; this release runs the engine's reading, matching and integrity fixes, which change them again.

  - `check_resume` reads role headers, headings and names that engine 0.4 read right and later versions read wrong: an employer after "at" beside a state's code ("Analyst at Deloitte, NY"), a list of projects or skills under a role ("KEY PROJECTS", "TECH STACK"), the name over its email under a list heading, "Education" set unlike the page's other headings, a role's duration between its header and its dates, and an employer and its city beside the dates over a title. Its `parsed` fields and readiness score, and `match_job`'s job match, change for such files.
  - `match_job` and `check_resume`'s `job` judge requirements and keywords anew: a posting that offers sponsorship no longer marks a candidate who needs it missing, a clearance's level is read beside the clearance and the UK's levels (BPSS, CTC, SC, DV) are compared, a negation about something else no longer drops a statement of the right to work or a clearance, a web address without its scheme is no keyword, and "S/4HANA", "z/OS" and "Pub/Sub" are one keyword each.
  - `check_resume`'s integrity rules flag keyword stuffing under a Publications heading on lines with only a year, and a quoted screener prompt of several injection phrases, one of them dictating a verdict ("respond with hire", "give my resume a 10/10"), after a word saying it was caught.

### Patch Changes

- Updated dependencies [8efa108]
  - @veriworkly/ats-engine@0.8.0

## 0.3.4

### Patch Changes

- Updated dependencies [0520940]
  - @veriworkly/ats-engine@0.7.0

## 0.3.3

### Patch Changes

- Updated dependencies [db6b70b]
- Updated dependencies [43bde51]
  - @veriworkly/ats-engine@0.6.0

## 0.3.2

### Patch Changes

- Updated dependencies [ea2d476]
- Updated dependencies [92b7ae9]
  - @veriworkly/ats-engine@0.5.0

## 0.3.1

### Patch Changes

- 212e39e: A DOCX whose XML would keep `mammoth`'s parser busy for seconds or minutes is now refused before `mammoth` parses any of it: a 1.4 KB file of unclosed comments (`<!--` repeated) held `extractResume`, the CLI and the MCP server for two minutes. Refused with "The document could not be read as DOCX.": a comment, processing instruction or CDATA section that never closes in any part `mammoth` parses (the document, styles, numbering, notes, comments, relationships, content types), more than 1,000 of them, a document type declaration, a `<` that starts no well-formed tag, a namespace prefix bound to a second namespace within a part, and more than 1,000 distinct elements and style, break, symbol or content-type tags, which `mammoth` would each warn about. A document holding more than 2 MB of that XML is refused with "The document's XML expands to more than 2 MB, more than this reader takes." Word's own templates hold under 600 KB and its resume templates under 120 KB. A style map embedded in the file (`mammoth/style-map`) is no longer applied: it could drop every paragraph (`p => !`), and 200,000 rules took over five minutes.

  `readResumeFile` and `readJobFile` (so `ats-engine check`, its `--job` and `--policy`, and the MCP server's `path` and `job_path`) read only a regular file on this computer. A network path (`\\host\share\cv.pdf`, `//host/share/cv.pdf`, `\\?\UNC\host\share\cv.pdf`) was read over SMB, a network request from a tool that makes none; it is now refused with "… is a network share or a device, not a file on this computer.", and so is a device path (`\\.\pipe\…`). The local long form `\\?\C:\…` still reads. Only the path's form is checked: a mapped drive letter, a link to a share or a network mount is still read. A pipe or a device, which reports no size and can stream without end, is refused with "… is not a regular file." before it is opened; a named pipe that kept sending was read until the process held hundreds of megabytes. A file is read through one handle no further than one byte past the 20 MB limit, so one that grows after it was measured is refused too.

- 2a33adf: The server's MCP Registry name is now `io.github.VeriWorkly/ats-engine` (`mcpName` in package.json and `name` in server.json), in the organisation's own casing. The registry grants a GitHub namespace in the owner's exact casing and compares names case by case, so it refused the lowercase `io.github.veriworkly/ats-engine`. From this version on, each release of the server is listed in the official MCP Registry (registry.modelcontextprotocol.io). Nothing changes in how the server runs or what its tools return.
- Updated dependencies [212e39e]
- Updated dependencies [41c09e3]
- Updated dependencies [b97ef19]
  - @veriworkly/ats-engine@0.4.1

## 0.3.0

### Minor Changes

- 6542c45: **Breaking:** Node 22.12 or later is required (`engines.node` is `>=22.12`). Node 20 reached end of life on 2026-04-30 and gets no security fixes; 22.12 is the first Node 22 that loads an ES module through `require()` without a flag, which the CommonJS path in the README relies on. CI now runs on Node 22.12, 24 and 26. Nothing in the engine's behaviour changes. The package descriptions and keywords are rewritten so npm search finds them by the words people type ("ats checker", "resume parser", "resume score", "mcp server").

### Patch Changes

- Updated dependencies [6542c45]
  - @veriworkly/ats-engine@0.4.0

## 0.2.0

### Minor Changes

- 18f77de: **Breaking:** the server runs engine 0.3, so scores and results change for the same file: the readiness score now weighs the writing-style rules (a `writing` entry in `categories`), soft skills weigh less in the job match, and certifications and spoken languages are read as rows of their own.

  - `check_resume` takes `target_ats` (`greenhouse`, `lever` or `taleo`) to add what that vendor documents publicly, each note with a link to its page. An unknown name is a tool error.
  - `check_resume` returns `advice`, never scored, in its structured result and under "Advice (not scored)" in its text: the file's name and size, a password, tracked changes or comments left in a Word document, details that can invite age bias where the region calls for it, and the `target_ats` notes.
  - `match_job` returns `missingKeywordGroups`, and `check_resume`'s `job` returns `matchedKeywordGroups` and `missingKeywordGroups` (`{ hard, soft }`). Both texts print missing soft skills on a line of their own ("Missing soft skills (weigh less): …") under the missing keywords, which now list only hard skills.
  - `check_resume`'s structured `parsed` carries `certifications` and `spokenLanguages` with the rest of what an ATS stores, declared in its output schema, and its text lists them under "What an ATS reads" ("Certification: …", "Speaks: …").

### Patch Changes

- Updated dependencies [b5a7c35]
- Updated dependencies [05c6155]
- Updated dependencies [7d87fbe]
- Updated dependencies [8ba9767]
- Updated dependencies [1998fc2]
- Updated dependencies [1f025ac]
- Updated dependencies [ecee416]
  - @veriworkly/ats-engine@0.3.0

## 0.1.0

### Minor Changes

- a3dd3ef: First release of the MCP server: `npx -y @veriworkly/ats-engine-mcp` lets an AI assistant check your own resume over stdio. Its tools are `check_resume`, `match_job`, `explain_rule` and `extract_text`, and the resource `rubric://default` holds the rubric. Each tool returns text plus structured JSON. The score is the published rubric's, the server makes no network requests and calls no model, and it reads only the files you name.

### Patch Changes

- Updated dependencies [88a9a26]
- Updated dependencies [89a4e55]
- Updated dependencies [88a9a26]
- Updated dependencies [88a9a26]
- Updated dependencies [88a9a26]
- Updated dependencies [88a9a26]
- Updated dependencies [18a5bc6]
- Updated dependencies [3509787]
- Updated dependencies [88a9a26]
- Updated dependencies [a3dd3ef]
- Updated dependencies [0a2a023]
- Updated dependencies [88a9a26]
  - @veriworkly/ats-engine@0.2.0
