---
"@veriworkly/ats-engine": minor
---

**Breaking:** more look-alike letters are flagged, and the redaction sent with `analyze` catches more phones, so integrity scores change for the same resume.

- **A Greek symbol before a subscript the policy does not list is a look-alike.** "νery" and "ρank" passed the look-alike check as a symbol before a short subscript, as "νmax" does. A lowercase Greek symbol is now excused only before a subscript in the new `text.symbolSubscripts` ("max", "min", "obs", "eff", "cat", "syn" and others); before anything else the word is flagged. Greek words and Greek lines are not, and neither is a word with fewer than three Latin letters, so "Gαs" and "κon" still pass.
- **A phone dialled with an exit prefix is redacted whole.** "011 44 20 7946 0958" (dialled from the US or Canada) was sent to the model as "011 44 [PHONE]". The exit prefixes "011", "0011" (Australia) and "010" (Japan) are now taken with the country code and the number after them, as "00" was; on its own, "011" is left as written.
