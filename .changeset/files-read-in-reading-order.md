---
"@veriworkly/ats-engine": minor
---

**Breaking:** PDF and DOCX files are read the way a person reads them, so the text, the layout signals and the scores change for the same file.

- PDF text is ordered by position on the page (top to bottom, left to right, each column in turn) instead of the order the file paints it. Resumes printed from a browser with floated dates, timelines or positioned blocks used to come out scrambled and lose every role.
- DOCX header and footer text is read (header first, footer last), so contact details in a Word header are no longer lost.
- Link targets are read from PDF link annotations and DOCX hyperlinks, so "LinkedIn" linked to a profile yields the profile address.
- Hidden text: a transparent copy that browsers draw under outlined, gradient or shadowed text is no longer flagged; text state is restored with the graphics state, so text after a hidden run is not flagged with it; every page with text is measured, not only the first six; a DOCX too large to measure is refused rather than read unchecked; white text on a styled paragraph band is judged against the band. The new `layout.hiddenText` carries the hidden text (up to 5,000 characters), and the job match leaves it out.
- Right-aligned dates on a single-column resume are not mistaken for a second column. Bullets a browser draws as shapes are read as bullets, a letter-spaced name keeps its word gap, and gaps wide enough to separate skill tags are kept.
- DOCX: only pictures count as images (not text boxes), and an "altChunk" document saved by web builders is read.
- Text files in UTF-16 or Windows-1252 are decoded correctly; `.html` resumes are read as HTML (`AtsResumeFormat` gains `"html"`); `.rtf` and unknown formats are refused with a clear message; a MIME type with parameters is recognised. A password-protected or damaged PDF gets a plain explanation.
- Job pages: inline tags no longer split words ("Node.js", "TypeScript", "C++"), page furniture and hidden elements stay out, more HTML entities are decoded, and structured JSON-LD requirements, `@id` employers and URI `@type`s are read.
- JSON Resume: profiles without a URL, the pre-1.0 `work[].company`, and education `score` and `courses` are read.
