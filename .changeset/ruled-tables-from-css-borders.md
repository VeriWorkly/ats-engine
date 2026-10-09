---
"@veriworkly/ats-engine": minor
---

**Breaking:** PDF tables drawn with CSS borders are found, so `layout.tableCount`, the `ats-v2.format.tables` rule and the score change for the same file. A resume printed from a browser draws a 1px border as a thin filled rectangle, not a stroked line, and only stroked lines were looked for: a layout built from a bordered HTML table reported "No ruled tables were found".

- Tables are now also read from the page's own drawing: horizontal and vertical rules, stroked or filled, up to 1.5pt thick, that close at least two rows of two cells with text in them. Collapsed and separate borders both count, as do classic stroked grids. The larger of this count and pdf-parse's is reported, from the first six pages as before.
- A table drawn after thousands of thin decorative shapes (a dotted background, an underline
  per word) is still found, and a stray hairline through a cell no longer counts as its side.
- Not tables: a divider under a heading, underlines, a border round the page or round one box, a bordered page split into a header and two columns, skill bars, coloured header bands.
