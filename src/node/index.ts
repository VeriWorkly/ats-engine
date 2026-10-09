/**
 * @veriworkly/ats-engine/node — reading resume files, on Node.
 *
 * `extractResume` turns a PDF, DOCX, HTML or text upload into the text the scorer reads plus the
 * layout signals the format rules grade and the file advice reads. `/node/child` wraps it in a
 * process a server can fork and kill. `readResumeFile` and `readJobFile` read a file from a path
 * with the limits and messages of the `ats-engine` CLI, and `readResumeFile` also says what the
 * file was (`file`, for `check`'s `file` option). PDF support needs `pdf-parse` and
 * `pdfjs-dist`; DOCX needs `mammoth`.
 */

export {
  detectResumeFormat,
  extractResume,
  MAX_EXTRACTED_CHARS,
  normalizeExtractedText,
  type AtsExtraction,
  type AtsResumeFormat,
} from "./extract.js";
export {
  AtsFileError,
  MAX_FILE_BYTES,
  readJobFile,
  readResumeFile,
  type AtsJobFile,
  type AtsReadFileOptions,
} from "./files.js";
export type { AtsExtractRequest, AtsExtractResponse } from "./protocol.js";
