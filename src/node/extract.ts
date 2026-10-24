import type { AtsLayoutSignals } from "../types.js";
import { decodeEntities, htmlText, readHtml } from "../job/html.js";
import {
  checkParsedXml,
  docxChunks,
  docxMargins,
  hiddenSignals,
  MAX_DOCX_EXPANDED_BYTES,
  measureDocx,
  openDocx,
  UNMEASURABLE_DOCX,
  UNREADABLE_DOCX,
  withinExpansionLimit,
} from "./docx.js";
import { withLinks } from "./lines.js";
import { optional } from "./peer.js";
import { extractPdf } from "./pdf.js";

/**
 * Resume text and page geometry from an uploaded file.
 *
 * PDF needs `pdf-parse` and `pdfjs-dist`, DOCX needs `mammoth`: optional peers, loaded only when
 * a document of that format arrives.
 *
 * In-process and CPU-bound: a pathological PDF can occupy the thread for seconds. A server should
 * run this in a process it can kill (see `@veriworkly/ats-engine/node/child`).
 */

/** `html`: a resume saved as a web page, read for its visible text rather than its markup. */
export type AtsResumeFormat = "pdf" | "docx" | "html" | "text";

/**
 * `layout` is present only for formats whose geometry can be measured. Downstream, its absence
 * means "not known", never "fine".
 */
export type AtsExtraction = { text: string; layout?: AtsLayoutSignals };

/**
 * Text beyond this is not a resume, and the scorer reads no more: a file's text is cut here and
 * `layout.textCut` set, which `check` reports in `parsingWarnings`.
 */
export const MAX_EXTRACTED_CHARS = 50_000;

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/**
 * The format of an upload from its name and declared type, or `null` when unsupported. A type's
 * parameters ("application/pdf; charset=binary") are ignored. HTML is read as a page, not as
 * text; RTF, whose markup would be read as words, is not supported.
 */
export function detectResumeFormat(fileName: string, mimeType = ""): AtsResumeFormat | null {
  const name = fileName.toLowerCase();
  const mime = mimeType.split(";")[0]!.trim().toLowerCase();
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf";
  if (mime === DOCX_MIME || name.endsWith(".docx")) return "docx";
  if (mime === "text/html" || mime === "application/xhtml+xml" || /\.x?html?$/.test(name))
    return "html";
  if (mime === "text/rtf" || name.endsWith(".rtf")) return null;
  if (mime.startsWith("text/") || /\.(txt|md|json)$/.test(name)) return "text";
  return null;
}

/**
 * Strips NULs and collapses runs of blanks and blank lines. A run holding a tab becomes one tab,
 * not a space: a tab is the column gap the parser splits a title from its employer at.
 */
export function normalizeExtractedText(text: string): string {
  return collapse(text).slice(0, MAX_EXTRACTED_CHARS);
}

function collapse(text: string) {
  return text
    .replace(/\0/g, "")
    .replace(/[ \t]+/g, (run) => (run.includes("\t") ? "\t" : " "))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * A text file's characters: UTF-16 by its byte-order mark, else UTF-8, and Windows-1252 where the
 * bytes are not UTF-8. A UTF-8 file with a stray byte is not decoded wholesale as Windows-1252,
 * nor is one whose UTF-8 byte-order mark says what it is.
 */
export function decodeText(data: Uint8Array): string {
  const [first, second, third] = data;
  if (first === 0xff && second === 0xfe) return new TextDecoder("utf-16le").decode(data);
  if (first === 0xfe && second === 0xff) return new TextDecoder("utf-16be").decode(data);
  const marked = first === 0xef && second === 0xbb && third === 0xbf;
  // A file with fewer valid multibyte characters than stray bytes is Windows-1252 throughout.
  let [multibyte, stray] = [0, 0];
  for (let at = 0, length = 0; at < data.length; at += length || 1) {
    length = sequence(data, at);
    if (length > 1) multibyte += 1;
    if (!length) stray += 1;
  }
  // The decoders below drop the mark itself.
  if (stray > multibyte && !marked) return cp1252(data);
  if (!stray) return new TextDecoder().decode(data);
  // Stray bytes are each written as their Windows-1252 character in UTF-8 and the whole is
  // decoded once: a decode per stray byte is quadratic.
  const out = new Uint8Array(data.length + stray * 2);
  let [start, written] = [0, 0];
  const copy = (end: number) => {
    out.set(data.subarray(start, end), written);
    written += end - start;
  };
  for (let at = 0; at < data.length;) {
    const length = sequence(data, at);
    if (length) {
      at += length;
      continue;
    }
    copy(at);
    out.set(CP1252_UTF8[data[at]! - 0x80]!, written);
    written += CP1252_UTF8[data[at]! - 0x80]!.length;
    start = at += 1;
    // A byte-order mark right after a stray byte is dropped, as decoding the run alone would.
    if (data[at] === 0xef && data[at + 1] === 0xbb && data[at + 2] === 0xbf) start = at += 3;
  }
  copy(data.length);
  return new TextDecoder().decode(out.subarray(0, written));
}

/** Node decodes "windows-1252" as Latin-1, leaving 0x80-0x9F as controls: map them to Windows-1252's. */
const cp1252 = (data: Uint8Array) =>
  new TextDecoder("latin1")
    .decode(data)
    .replace(/[\u0080-\u009f]/g, (char) => CP1252[char.charCodeAt(0) - 0x80]!);

/** The length of the well-formed UTF-8 sequence at `at`, or 0. */
function sequence(data: Uint8Array, at: number): number {
  const lead = data[at]!;
  if (lead < 0x80) return 1;
  const length = lead < 0xc2 ? 0 : lead < 0xe0 ? 2 : lead < 0xf0 ? 3 : lead < 0xf5 ? 4 : 0;
  // The second byte's range rules out overlong forms, surrogates and code points past U+10FFFF.
  const low = lead === 0xe0 ? 0xa0 : lead === 0xf0 ? 0x90 : 0x80;
  const high = lead === 0xed ? 0x9f : lead === 0xf4 ? 0x8f : 0xbf;
  for (let next = 1; next < length; next += 1) {
    const byte = data[at + next];
    if (byte === undefined || byte < (next === 1 ? low : 0x80) || byte > (next === 1 ? high : 0xbf))
      return 0;
  }
  return length;
}

/** Windows-1252's characters for 0x80-0x9F; its five unassigned codes stay as they are. */
const CP1252 = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

/** Bytes 0x80-0xFF as their Windows-1252 characters in UTF-8: what a stray byte becomes. */
const CP1252_UTF8 = /* @__PURE__ */ [
  ...cp1252(Uint8Array.from({ length: 128 }, (_, i) => 0x80 + i)),
].map((char) => new TextEncoder().encode(char));

/** A link's target in `mammoth`'s HTML: one bounded run of attribute text. */
const HREF = /<a href="([^"<>]*)"/g;

async function extractDocx(data: Uint8Array): Promise<AtsExtraction> {
  const archive = openDocx(data);
  if (!archive) throw new Error(UNREADABLE_DOCX);
  if (!withinExpansionLimit(data, archive))
    throw new Error(
      `The document expands to more than ${MAX_DOCX_EXPANDED_BYTES / 1024 / 1024} MB; it is not a resume.`,
    );
  // Measured first: a document that cannot be measured is refused before `mammoth` reads it.
  // There is no page geometry, so columns stay unmeasured.
  let measured: ReturnType<typeof measureDocx> = null;
  try {
    measured = measureDocx(data, archive);
  } catch (error) {
    if ((error as Error).message === UNMEASURABLE_DOCX) throw error;
    // Any other failure yields no signals, not a failed upload.
  }
  // Before `mammoth` parses: its XML parser takes minutes over markup that never closes.
  checkParsedXml(archive);
  const mammoth = await optional(() => import("mammoth"), "mammoth");
  // Through HTML, not raw text, which drops Word's list bullets. Images become empty tags, and an
  // embedded style map is ignored: it can drop paragraphs an ATS reads.
  const { value: html } = await mammoth
    .convertToHtml(
      { buffer: Buffer.from(data) },
      {
        convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
        includeEmbeddedStyleMap: false,
      },
    )
    .catch((cause: unknown) => {
      throw new Error(UNREADABLE_DOCX, { cause });
    });
  // What `mammoth` leaves out: header, footer, embedded HTML (read as a resume page, hidden
  // elements counted), and link targets.
  const { header, footer } = docxMargins(archive);
  const chunks = docxChunks(archive).map((chunk) => readHtml(chunk, "document"));
  const value = withLinks(
    [header, htmlText(html), ...chunks.map((chunk) => chunk.text), footer].join("\n"),
    [...html.matchAll(HREF)].map(([, href]) => decodeEntities(href!)),
  );
  if (!measured) return { text: value };
  const chunked = chunks.flatMap((chunk) => chunk.hidden);
  return {
    text: value,
    layout: {
      columnRatio: null,
      tableCount: measured.tableCount,
      pageCount: 0,
      imageCount: measured.imageCount,
      ...hiddenSignals([measured.hiddenText, ...chunked]),
      // Only the document's own: `readHtml` leaves an embedded page's hidden elements out of the text.
      hiddenTextRead: measured.hiddenTextRead,
      // Counted whole: `hiddenText` is cut to `MAX_HIDDEN_TEXT`.
      hiddenTextChars: measured.hiddenChars + hiddenSignals(chunked).hiddenTextChars,
      trackedChanges: measured.trackedChanges,
      comments: measured.comments,
    },
  };
}

/** A resume saved as a web page: visible text, hidden elements reported as hidden, tables counted. */
function readHtmlResume(html: string): AtsExtraction {
  const { text, hidden, tables } = readHtml(html, "document");
  return {
    text,
    // Hidden elements are left out of the text, so none of it is read.
    layout: {
      columnRatio: null,
      tableCount: tables,
      pageCount: 0,
      ...hiddenSignals(hidden),
      hiddenTextRead: "",
    },
  };
}

/**
 * Extracts and normalises a resume's text, with the layout signals the format can show: page
 * geometry, pictures, hidden text, metadata and encryption for a PDF; tables, pictures, hidden
 * text, tracked changes and comments for a DOCX; tables and hidden elements for an HTML page.
 * None for plain text.
 */
export async function extractResume(
  data: Uint8Array,
  format: AtsResumeFormat,
): Promise<AtsExtraction> {
  const raw =
    format === "pdf"
      ? await extractPdf(data, MAX_EXTRACTED_CHARS)
      : format === "docx"
        ? await extractDocx(data)
        : format === "html"
          ? readHtmlResume(decodeText(data))
          : format === "text"
            ? { text: decodeText(data) }
            : null;
  // A format from outside the type (over IPC, say) is refused, not read as text.
  if (!raw) throw new Error(`Unsupported resume format "${String(format)}".`);
  const text = collapse(raw.text);
  // With no layout to carry the flag (a text file), the text is read as if pasted: `check` cuts
  // it and says so. Twice the cut leaves room for what its own normalising removes.
  if (!raw.layout) return { text: text.slice(0, MAX_EXTRACTED_CHARS * 2) };
  if (text.length <= MAX_EXTRACTED_CHARS) return { ...raw, text };
  // Skills often come last: the cut is reported, never silent.
  return {
    text: text.slice(0, MAX_EXTRACTED_CHARS),
    layout: { ...raw.layout, textCut: true },
  };
}
