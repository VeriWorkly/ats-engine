---
"@veriworkly/ats-engine": minor
"@veriworkly/ats-engine-mcp": patch
---

PDF reading no longer decodes an image of more than 4096 × 4096 pixels (about a letter page scanned at 400 dpi). A crafted PDF of a few huge images used to make the reader allocate gigabytes of pixels outside V8's heap, enough to have the process killed. pdf.js now leaves such an image undrawn, so in a PDF that has one, the image and hidden-text signals (`imageOnlyPages`, `imageCount`, `hiddenTextChars`) are reported as not measured rather than read from a page missing its picture: a 600 dpi scan is not called a blank page, and its OCR layer is not called hidden text. PDFs without such an image read exactly as before.
