import type { AtsLayoutSignals } from "../types.js";
import { decodeEntities, htmlText, readHtml } from "../job/html.js";
import {
  docxChunks,
  docxMargins,
  MAX_DOCX_EXPANDED_BYTES,
  MAX_HIDDEN_TEXT,
  measureDocx,
  readableArchive,
  UNMEASURABLE_DOCX,
  withinExpansionLimit,
} from "./docx.js";
import { withLinks } from "./lines.js";
import { optional } from "./peer.js";
import { extractPdf } from "./pdf.js";

/**
 * Resume text and page geometry from an uploaded file.
 *
 * PDF needs `pdf-parse` and `pdfjs-dist`, DOCX needs `mammoth`. They are optional peer
 * dependencies, loaded only when a document of that format arrives, so a host that reads only
 * one format installs only what it reads.
 *
 * In-process and CPU-bound: a pathological PDF can occupy the thread for seconds. A server
 * should run this in a process it can kill (see `@veriworkly/ats-engine/node/child`); a CLI or
 * a batch job can call it directly.
 */

/** `html`: a resume saved as a web page, read for its visible text rather than its markup. */
export type AtsResumeFormat = "pdf" | "docx" | "html" | "text";

/**
 * `layout` is present only for formats whose geometry can be measured. Downstream, its absence
 * means "not known", never "fine".
 */
export type AtsExtraction = { text: string; layout?: AtsLayoutSignals };

/** Text beyond this is not a resume; the scorer rejects longer input anyway. */
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
 * Strips NULs and collapses runs of blanks and blank lines, so the scorer sees clean lines.
 *
 * A run holding a tab becomes one tab rather than a space: a tab is the column gap a Word table
 * of contents or a text export puts between a job title and its employer, and the parser splits
 * the two there. Collapsing it to a space merged them into one title on every upload.
 */
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\0/g, "")
    .replace(/[ \t]+/g, (run) => (run.includes("\t") ? "\t" : " "))
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, MAX_EXTRACTED_CHARS);
}

/**
 * A text file's characters: UTF-16 by its byte-order mark, else UTF-8 — and, where the bytes are
 * not UTF-8, Windows-1252, the encoding Notepad and Word's "plain text" wrote for years. Decoding
 * those as UTF-8 turned every accented letter and curly quote into "�"; decoding a whole UTF-8
 * file as Windows-1252 for one stray byte in it turned every "é" into "Ã©".
 */
function decodeText(data: Uint8Array): string {
  const [first, second] = data;
  if (first === 0xff && second === 0xfe) return new TextDecoder("utf-16le").decode(data);
  if (first === 0xfe && second === 0xff) return new TextDecoder("utf-16be").decode(data);
  const utf8 = new TextDecoder();
  // Bytes that are not UTF-8 among many that are — one stray byte pasted into a UTF-8 file — are
  // read one at a time; a file with fewer valid multibyte characters than stray bytes is
  // Windows-1252 throughout.
  const parts: string[] = [];
  let [start, multibyte, stray] = [0, 0, 0];
  for (let at = 0; at < data.length;) {
    const length = sequence(data, at);
    if (length > 1) multibyte += 1;
    if (length) {
      at += length;
      continue;
    }
    parts.push(utf8.decode(data.subarray(start, at)), cp1252(data.subarray(at, at + 1)));
    stray += 1;
    start = at += 1;
  }
  if (stray > multibyte) return cp1252(data);
  parts.push(utf8.decode(data.subarray(start)));
  return parts.join("");
}

/** Node decodes "windows-1252" as Latin-1, leaving 0x80-0x9F as control characters: those are
 * Windows-1252's curly quotes, dashes, euro sign and the rest. */
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

/** What a DOCX upload that is not one fails with; the reader's own error is kept as the cause. */
const UNREADABLE_DOCX = "The document could not be read as DOCX.";

/** A link's target in `mammoth`'s HTML: one bounded run of attribute text. */
const HREF = /<a href="([^"<>]*)"/g;

async function extractDocx(data: Uint8Array): Promise<AtsExtraction> {
  if (!readableArchive(data)) throw new Error(UNREADABLE_DOCX);
  if (!withinExpansionLimit(data))
    throw new Error(
      `The document expands to more than ${MAX_DOCX_EXPANDED_BYTES / 1024 / 1024} MB; it is not a resume.`,
    );
  // Measured first: a document whose text cannot be measured is refused before `mammoth` reads
  // it, rather than read with every layout rule silently dropped. A Word document has no page
  // geometry, so columns stay unmeasured; what its XML says — tables, pictures, hidden runs — is
  // read directly.
  let measured: ReturnType<typeof measureDocx> = null;
  try {
    measured = measureDocx(data);
  } catch (error) {
    if ((error as Error).message === UNMEASURABLE_DOCX) throw error;
    // An archive this reader cannot follow otherwise yields no signals, not a failed upload.
  }
  const mammoth = await optional(() => import("mammoth"), "mammoth");
  // Through HTML rather than mammoth's raw text: Word keeps bullets as list numbering, not as
  // characters, and the raw text drops them, which read every bulleted DOCX resume as prose.
  // Images become empty tags instead of the embedded base64 mammoth writes by default.
  // A malformed file fails inside mammoth with whatever its parser hit — "Cannot read properties
  // of null" — which says nothing to the person who uploaded it.
  const { value: html } = await mammoth
    .convertToHtml(
      { buffer: Buffer.from(data) },
      { convertImage: mammoth.images.imgElement(async () => ({ src: "" })) },
    )
    .catch((cause: unknown) => {
      throw new Error(UNREADABLE_DOCX, { cause });
    });
  // What `mammoth` leaves out and an ATS that reads the whole file sees: the page header (often
  // the name and contact details) before the body, the footer after it, HTML embedded whole, and
  // the targets of links whose text is only "LinkedIn".
  // An embedded page is read as a resume page is: what its markup hides is left out, and counted.
  const { header, footer } = docxMargins(data);
  const chunks = docxChunks(data).map((chunk) => readHtml(chunk, "document"));
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
      // Counted whole: the document's hidden text above is cut to its first 5,000 characters.
      hiddenTextChars: measured.hiddenChars + hiddenSignals(chunked).hiddenTextChars,
    },
  };
}

/**
 * Hidden text as the layout reports it: every run, whitespace collapsed, joined in reading order.
 */
function hiddenSignals(runs: readonly string[]) {
  const text = runs.join(" ").replace(/\s+/g, " ").trim();
  return {
    hiddenTextChars: text.replace(/\s/g, "").length,
    hiddenTextSample: text.slice(0, 80),
    hiddenText: text.slice(0, MAX_HIDDEN_TEXT),
  };
}

/**
 * A resume saved as a web page: the text a reader sees, without the elements its markup hides,
 * whose text is reported as hidden; its tables are counted as a Word document's are. A page has
 * no geometry to measure columns by.
 */
function readHtmlResume(html: string): AtsExtraction {
  const { text, hidden, tables } = readHtml(html, "document");
  return {
    text,
    layout: { columnRatio: null, tableCount: tables, pageCount: 0, ...hiddenSignals(hidden) },
  };
}

/** Extracts and normalises a resume's text, with page geometry for PDFs. */
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
  // A format from outside the type — over the child process's IPC, say — is refused, not read
  // as text.
  if (!raw) throw new Error(`Unsupported resume format "${String(format)}".`);
  return { ...raw, text: normalizeExtractedText(raw.text) };
}
