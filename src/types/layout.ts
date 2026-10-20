/**
 * Geometry recovered while parsing an uploaded document, for checks that text cannot answer.
 * `columnRatio` is the share of content lines split by a gutter-wide gap (a two-column layout,
 * sidebar or text box); `tableCount` the ruled table grids traced from the page's drawing
 * operators. Absent for pasted text and structured documents; the rules that depend on it are
 * then omitted rather than assumed to pass.
 */
export type AtsLayoutSignals = {
  /** `null` when the document had too few content lines for the ratio to mean anything. */
  columnRatio: number | null;
  tableCount: number;
  pageCount: number;
  /** Images at least 80px a side — a photo, rarely a logo. Absent when it was not measured. */
  imageCount?: number;
  /** Characters a reader cannot see but an ATS reads: page-coloured, tiny, off-page, invisible or under an image. */
  hiddenTextChars?: number;
  /**
   * All of that hidden text, whitespace collapsed, runs joined in reading order, cut to 5,000
   * characters. Present whenever `hiddenTextChars` is; "" when nothing is hidden.
   */
  hiddenText?: string;
  /**
   * The part of `hiddenText` the document's text holds too (collapsed, joined and cut the same
   * way): what an ATS reads, which the job match leaves out. A PDF: all of it; DOCX: all but runs
   * a header or footer marks hidden; HTML: none. Absent when the extractor does not pass it; the
   * engine then sets aside by `hiddenText`.
   */
  hiddenTextRead?: string;
  /** Pages with no text layer at all: a scan, or a page exported as a picture. */
  imageOnlyPages?: number;
  /** The file's title, subject, keywords and author fields: not scored, read for instructions aimed at an AI. */
  metadataText?: string;
  /** A PDF that opened without a password but is encrypted (an owner password). Advice only. */
  encrypted?: boolean;
  /** A Word document's tracked changes and comments still in the file. DOCX only; advice only. */
  trackedChanges?: number;
  comments?: number;
};
