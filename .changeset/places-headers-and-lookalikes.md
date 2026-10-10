---
"@veriworkly/ats-engine": patch
---

- **A phone dialled with an exit prefix is redacted whole.** "011 44 20 7946 0958" (dialled from the US or Canada) was sent to the model as "011 44 [PHONE]". The exit prefixes "011", "0011" (Australia) and "010" (Japan) are now taken with the country code and the number after them, as "00" was; on its own, "011" is left as written.
