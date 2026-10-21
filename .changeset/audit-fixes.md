---
"@veriworkly/ats-engine": minor
---

Fixes from an audit of the engine.

- **Breaking:** text in a bordered box, a chip or a tinted band of a PDF is no longer read as hidden text. A border filled as two rectangles (as Chrome prints `border: 1px solid`) was taken for a solid box of its colour, and a translucent fill (`rgba(0, 0, 0, 0.06)`) for its full colour, so dark text in either failed the hidden-text check: a Chrome-printed resume with one tinted section scored 56 instead of 86. The inside of a border is now what lies under it, and a translucent fill is blended with what lies under it.
  - Still hidden: white text inside a border or on a faint tint, which was missed before.
