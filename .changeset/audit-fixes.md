---
"@veriworkly/ats-engine": minor
---

Fixes from an audit of the engine.

- **Breaking:** text in a bordered box, a chip or a tinted band of a PDF is no longer read as hidden text. A border filled as one frame, its outer rectangle with the inner cut out (`re re f*`), was taken for a solid box of its colour, and a translucent fill (`rgba(0, 0, 0, 0.06)`) for its full colour, so dark text in either failed the hidden-text check. A Chrome-printed resume with one tinted section scored 56 instead of 86; one with a table whose cells are framed so, 38 instead of 68. The inside of a border is now what lies under it, and a translucent fill is blended with what lies under it.
  - Still hidden: white text inside a border or on a faint tint, which was missed before.
- A PDF page the file declares millions of points wide is read in the time of any other page. The column search stepped across the declared width: a 50,000,000-point page took 12 seconds, so a small file of such pages held the reader for minutes. It now searches at most 14,400 points, the widest page a PDF allows.
