---
"@veriworkly/ats-engine": patch
---

When the PDF or DOCX reader is missing, the error now says how to install it: "Reading this format needs pdf-parse and pdfjs-dist installed beside the engine: npm install pdf-parse@2 pdfjs-dist@5.4.296 mammoth (with -g beside a global install; with npx, -p each of them)." It used to stop at "needs pdf-parse and pdfjs-dist installed.", which left `npx @veriworkly/ats-engine check resume.pdf` failing with no way forward: `npx` installs no optional peers. The README's quick start now installs the readers with the CLI (`npm install -g @veriworkly/ats-engine pdf-parse@2 pdfjs-dist@5.4.296 mammoth`, then `ats-engine check resume.pdf`) and gives the one-off `npx -p` form; a `.txt`, `.md`, `.html` or `.json` resume still runs with plain `npx`.
