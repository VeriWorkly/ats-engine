# @veriworkly/ats-engine-mcp

## 0.15.1

### Patch Changes

- 03c88f8: PDF reading no longer decodes an image of more than 4096 × 4096 pixels (about a letter page scanned at 400 dpi). A crafted PDF of a few huge images used to make the reader allocate gigabytes of pixels outside V8's heap, enough to have the process killed. pdf.js now leaves such an image undrawn, so in a PDF that has one, the image and hidden-text signals (`imageOnlyPages`, `imageCount`, `hiddenTextChars`) are reported as not measured rather than read from a page missing its picture: a 600 dpi scan is not called a blank page, and its OCR layer is not called hidden text. PDFs without such an image read exactly as before.
- Updated dependencies [03c88f8]
  - @veriworkly/ats-engine@0.22.0

## 0.15.0

### Minor Changes

- 4888dab: The audit's findings are fixed in the server and the engine it runs (engine 0.21.0).

  - A saved job posting page (`job_path` to an HTML file) is read in the reader's child process, under the same 60 s limit as a resume, so a 19 MB page no longer blocks the server.
  - A file the reader cannot open reports the reader's own reason ("InvalidPDFException: …"), and a malformed request to the child is answered instead of crashing it.
  - **Breaking:** answers for the same file change where the engine now reads better: hidden text in Word styles, PDF layers and HTML style sheets is flagged and kept out of the match, the contact line and link paths add no keywords, bulleted role headers and LinkedIn certification rows are read, and a report says when a resume or a posting's requirements were cut.

- a75165a: Mexico, Argentina, Colombia and Chile are read as their own regions (engine 0.21.0).

  - `region` accepts `MX`, `AR`, `CO` and `CL`. Without it, a Spanish or Portuguese resume's region also comes from its header (an email's country domain, the country's name or one of its cities) when its phone has no country code.
  - **Breaking:** answers for the same file change where the engine now reads it better: an honorific is left out of the name ("Dr. Miriam Hoffmann" reads "Miriam Hoffmann"), every Spanish role is read "Cargo en Empresa" once one role shows it, a city beside the dates under a stacked header is where, and a PDF's flush-right city over its dates is no longer a second column. On the reviewer's resumes, German, Hindi, Spanish and Portuguese go from 99.2–99.3% of fields right to 100%, and every pack is corrected by a linguist's review.

### Patch Changes

- Updated dependencies [4888dab]
- Updated dependencies [a75165a]
- Updated dependencies [a75165a]
  - @veriworkly/ats-engine@0.21.0

## 0.14.0

### Minor Changes

- c3a0d31: A resume in a language the engine has no pack for now says so.

  - **Breaking:** `check_resume`'s `locale` gains `unsupported` (`"it"`, `"Cyrillic"`, or `null`), and its text answer a "Language:" line: "This resume looks Italian, which the engine does not read yet: …". Scores do not change.

- c3a0d31: German, French and Hindi resumes read nearly as well as English ones, and Spanish and Portuguese are read too (engine 0.20.0).

  - **Breaking:** answers for the same file change where the engine now reads it better. On resumes written in each language, fields read right went from 80.0% to 99.2% in German, 89.8% to 97.6% in French, 88.4% to 99.2% in Hindi, 24.3% to 98.0% in Spanish and 23.3% to 99.3% in Portuguese; a city after the employer is left out of it; English answers change only where a field is read better.
  - `language` accepts `es` and `pt`, and `region` accepts `ES`, `BR` and `PT`.

### Patch Changes

- Updated dependencies [c3a0d31]
- Updated dependencies [c3a0d31]
  - @veriworkly/ats-engine@0.20.0

## 0.13.0

### Minor Changes

- 3dba46c: Choose the language a resume is read in, and acronyms no longer make English read as another language.

  - `check_resume` and `match_job` take `language` (`en`, `de`, `fr` or `hi`, any case; `en` reads English only). Without it the language is detected from the resume and the posting, as before. It sets the language of both, so it is for a resume read in the wrong language. An unknown code is refused with the list.
  - **Breaking:** with engine 0.19.0, a word in capitals among lower-case words ("MIT" in "BSc, MIT, 2016", "AB" in "Volvo AB") no longer counts as evidence of a language. An English resume with a few such acronyms was read with the German pack attached; it now reads as English. German, French and Hindi resumes and postings, headings in capitals included, read as before.

### Patch Changes

- Updated dependencies [3dba46c]
  - @veriworkly/ats-engine@0.19.0

## 0.12.0

### Minor Changes

- cbb6a1e: - **Breaking:** `check_resume` no longer counts a parental leave, career break or sabbatical, or a dated sentence that opens with a past-tense verb such as "Analysed 2017 thru 2018 data", as a job, so the experience and seniority it returns are no longer inflated.
  - **Breaking:** `check_resume` no longer reads a tagline before a title ("Open Source | Software Engineer") as the name.
  - **Breaking:** `check_resume` and `match_job` credit the language a resume is written in over a "Languages" list of programming languages the policy knows ("Python, Go"), in text and in JSON Resume alike.

### Patch Changes

- Updated dependencies [cbb6a1e]
  - @veriworkly/ats-engine@0.18.0

## 0.11.0

### Minor Changes

- 114ec96: - The server reads as many files at once as the computer has CPU cores; further calls wait their turn. 150 calls at once started 150 reading processes and 7.3 GB. A cancelled call now stops the process reading its file, and a call cancelled while it waits never starts one.

  - **Breaking:** `check_resume` no longer fails the hidden-text check, and returns a higher score, for a PDF with dark text in a square-cornered bordered box or a tinted band.
  - **Breaking:** `check_resume` keeps a current role dated "Till now", "onwards", "Continuing", "06/21 - Present", "bis heute", "ab 03/2020", "मार्च 2020 से" or "अभी तक", which it dropped, and the experience and score it returns change with it.
  - **Breaking:** `check_resume` reads a resume whose lines end in a lone carriage return, a vertical tab or a Unicode line separator line by line, which it read as one line, and returns a different score.
  - **Breaking:** `check_resume` and `match_job` no longer meet a right-to-work requirement with a statement about another country ("Authorized to work in the US" for a UK role), read "Must be a British citizen" as a citizenship requirement, and meet a citizenship requirement only with that country's citizenship (an Irish citizen may work in the UK and the EU, but is no U.S. or British citizen).
  - **Breaking:** a language requirement with a fluent level is missing, not met, by "currently learning", "school level" or "Schulkenntnisse".
  - **Breaking:** a clearance stated beside a negation about something else ("Active TS/SCI clearance, no lapses since 2015") meets a clearance requirement, which it did not.
  - **Breaking:** an expired, future-dated or in-progress certification is partial, not met, for any requirement naming it ("Active CISSP", "CISSP required"), and says why; a renewal listed after it meets.
  - **Breaking:** "Reacted", "Sparked", "rusted" and "R&D" no longer meet React, Spark, Rust and R, in the requirements and the job match score.
  - **Breaking:** a right-to-left Word resume no longer fails the invisible-characters check for the direction embeddings Word writes, and scores 10 points higher.
  - **Breaking:** a JSON Resume whose current role ends in "heute", "Current role" or another open end the engine reads, written alone, is current, with its full experience, not one month.
  - **Breaking:** `check_resume` reads the text of a Chinese, Japanese or Korean PDF whose font uses a standard CJK character map, which came out empty.
  - **Breaking:** `check_resume` and `match_job` read `job_text` and `job_path` to 20,000 characters instead of 12,000, so job match scores change for postings over 12,000 characters (a 12,681-character posting with its requirements last: 36 → 4). Past 20,000, `check_resume`'s `parsingWarnings` notes the cut.
  - **Breaking:** requirements follow the engine: "or related field" no longer stands in for a degree, and German "-kenntnisse" compounds and the language the resume's sentences are written in (at C1, when no languages are listed) count for a language requirement.
  - **Breaking:** `check_resume` reads a name followed by a title on the first line ("Mira Kestrel | Senior Software Engineer") when one email or profile link spells every word of it (mira.kestrel@…, mkestrel@…, linkedin.com/in/mira-kestrel), a school from a tab-separated education line, and a JSON Resume with empty entries first, no `basics`, or `work` as one object, and its score changes with them.
  - **Breaking:** `check_resume` finds hidden text in a PDF clipped out of view, drawn in a blend mode that leaves the page unchanged, or set on a blank image of its own colour, and scores such a file lower.
  - **Breaking:** `check_resume` measures a PDF's annotations for hidden text: a white box drawn over text is hidden text, and a highlight is not.
  - On Linux and macOS, `path` and `job_path` starting with `//` are read.

### Patch Changes

- Updated dependencies [85578af]
- Updated dependencies [114ec96]
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
