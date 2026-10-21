---
"@veriworkly/ats-engine": minor
---

Fixes from an audit of the engine.

- **Breaking:** text in a bordered box, a chip or a tinted band of a PDF is no longer read as hidden text. A border filled as one frame, its outer rectangle with the inner cut out (`re re f*`), was taken for a solid box of its colour, and a translucent fill (`rgba(0, 0, 0, 0.06)`) for its full colour, so dark text in either failed the hidden-text check. A Chrome-printed resume with one tinted section scored 56 instead of 86; one with a table whose cells are framed so, 38 instead of 68. The inside of a border is now what lies under it, and a translucent fill is blended with what lies under it.
  - Still hidden: white text inside a border or on a faint tint, which was missed before.
- A PDF page the file declares millions of points wide is read in the time of any other page. The column search stepped across the declared width: a 50,000,000-point page took 12 seconds, so a small file of such pages held the reader for minutes. It now searches at most 14,400 points, the widest page a PDF allows.
- A document with many copies of one link is read in the time of any other. Each link's address was looked for in the whole text, once per copy: 2,000 copies over 2 MB of text took a second, and a small Word file of repeated links took minutes. Each address is now looked for once, in the first 50,000 characters (what extraction keeps), and at most 1,000 distinct addresses are looked for.
- An HTML page a Word document embeds (`w:altChunk`) is read once, however often the document names it, and the embedded pages share 8 MB between them. Each name read the page again, up to 8 MB each: one 2 MB page named 30 times took 1.6 seconds. A page past what is left is not read.
- **Breaking:** more ways of writing a current role's dates are read, so the role is no longer dropped, and the experience and seniority read from it no longer halve. A role dated "Jun 2021 - Till now" was missing from the work history, with no warning.
  - English: "Till now", "Continuing", "Jun 2021 onwards" (and "onward"), and "thru" between two dates.
  - A month and two-digit year, between two such dates or before an open end: "06/21 - Present", "01/15 - 05/21". Alone, "10/10" is still no date.
  - German: "– bis heute", "bis jetzt", "bis dato", and "ab 03/2020". Hindi: "अभी तक", and "मार्च 2020 से" with nothing after "से". French: "hiver" as a season (January to March).
  - **Breaking:** the default policy's `resumeParse.openEnded` gains "till now", "continuing", "onwards" and "onward", and `resumeParse.rangeWords` gains "thru". The default policy's fingerprint changes.
