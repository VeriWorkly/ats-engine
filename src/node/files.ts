import { constants, type Stats } from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import { isJsonResume, isResumeDocument } from "../document/index.js";
import type { AtsResumeInput } from "../input.js";
import type { AtsFileInfo } from "../types.js";
import { extractJobPosting, jobTextFromHtml, normalizeJobText } from "../job/index.js";
import {
  detectResumeFormat,
  extractResume,
  type AtsExtraction,
  type AtsResumeFormat,
} from "./extract.js";

/**
 * Reading a resume or a job posting from a path the user named: the CLI's `check` and the MCP
 * server read files the same way, with the same limits and the same messages.
 */

/** A file that cannot be read as asked. The message is for the person who named the file. */
export class AtsFileError extends Error {
  override name = "AtsFileError";
}

/**
 * The largest file read. A resume or a posting with a text layer is a few hundred kilobytes; a
 * file past this is refused before it is read into memory rather than after.
 */
export const MAX_FILE_BYTES = 20 * 1024 * 1024;

/** Options of `readResumeFile` and `readJobFile`. */
export type AtsReadFileOptions = {
  /** Refuse a larger file. Default `MAX_FILE_BYTES`. */
  maxBytes?: number | undefined;
  /**
   * Reads a PDF or DOCX file's bytes; default `extractResume`, in this process. A host that reads
   * files it did not write passes one that runs `/node/child` instead, so a file that exhausts
   * memory or never ends takes down that process, not the host. The path, type and size checks
   * stay here either way.
   */
  extract?: ((data: Uint8Array, format: AtsResumeFormat) => Promise<AtsExtraction>) | undefined;
};

/** The folder, the pipe or device, and the file over the limit, refused with their reasons. */
function checkFile(info: Stats, path: string, maxBytes: number) {
  if (info.isDirectory()) throw new AtsFileError(`${path} is a folder, not a file.`);
  if (!info.isFile()) throw new AtsFileError(`${path} is not a regular file.`);
  if (info.size > maxBytes)
    throw new AtsFileError(
      `${path} is ${size(info.size)}; files over ${size(maxBytes)} are not read.`,
    );
}

/**
 * A file's bytes, with the usual mistakes — no such file, a folder, too large — named plainly.
 * Only a regular file on this computer is read: a network share would be read over the network,
 * and a pipe or a device reports no size and can stream without end. Read through one handle, at
 * most one byte past the limit, so a file that grows after it was measured is still refused.
 */
export async function readFileBytes(
  path: string,
  { maxBytes = MAX_FILE_BYTES }: AtsReadFileOptions = {},
): Promise<Buffer> {
  // A path that starts with two slashes names another computer (`\\host\share`, `//host/share`,
  // `\\?\UNC\…`) or a device (`\\.\pipe\…`, `\\?\GLOBALROOT\…`), except the long form of a local
  // path, `\\?\C:\…`. Checked as given and as resolved: on Windows a relative path resolves onto
  // a share when the working folder is one. Only the path's form is read: a mapped drive letter,
  // a link to a share or a network mount looks local and is read over the network.
  if ([path, resolve(path)].some((form) => /^[\\/]{2}(?!\?\\[A-Za-z]:\\)/.test(form)))
    throw new AtsFileError(`${path} is a network share or a device, not a file on this computer.`);
  try {
    // Measured before it is opened: opening a device can act on it (a watchdog arms, a tape
    // rewinds) or wait.
    checkFile(await stat(path), path, maxBytes);
    // Read-only (`O_RDONLY` is 0) and without blocking: opening a FIFO otherwise waits for a
    // writer. Windows has no such flag, and no FIFOs.
    const handle = await open(path, constants.O_NONBLOCK ?? "r");
    try {
      // The handle's file is the one measured and read, whatever the path names meanwhile.
      const info = await handle.stat();
      checkFile(info, path, maxBytes);
      const chunks: Buffer[] = [];
      for await (const chunk of handle.createReadStream({ end: maxBytes, autoClose: false }))
        chunks.push(chunk as Buffer);
      const data = Buffer.concat(chunks);
      // At the size read: a file that grew past the limit after it was measured is refused too.
      info.size = data.length;
      checkFile(info, path, maxBytes);
      return data;
    } finally {
      await handle.close();
    }
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ENOENT") throw new AtsFileError(`No such file: ${path}`);
    if (code === "EISDIR") throw new AtsFileError(`${path} is a folder, not a file.`);
    throw error;
  }
}

/** "20 MB", "1.5 KB": one decimal at most. */
function size(bytes: number): string {
  const [value, unit] = bytes >= 1024 * 1024 ? [bytes / 1024 / 1024, "MB"] : [bytes / 1024, "KB"];
  return `${Math.round(value * 10) / 10} ${unit}`;
}

/** A file's JSON, or an error naming the file. */
export function parseJsonFile(data: Buffer, path: string): unknown {
  try {
    return JSON.parse(data.toString("utf8"));
  } catch (error) {
    // Only where it failed: the parser's message quotes the text near the error, which can be a
    // secret.
    const where = /\(line \d+ column \d+\)/.exec((error as Error).message)?.[0];
    throw new AtsFileError(`${path} is not valid JSON${where ? ` ${where}` : ""}.`);
  }
}

/**
 * A resume file as the scorer takes it: the extracted text and, where measurable, its layout; or
 * the document itself for a `.json` JSON Resume or ats-resume document. PDF and DOCX need the
 * optional peers `extractResume` needs. `file` (its name, size and format) is `check`'s `file`
 * option, for the advice on the file itself.
 */
export async function readResumeFile(
  path: string,
  options?: AtsReadFileOptions,
): Promise<{ input: AtsResumeInput; file: AtsFileInfo } & Partial<AtsExtraction>> {
  const format = detectResumeFormat(path);
  if (!format)
    throw new AtsFileError(
      `Unsupported resume file type "${extname(path) || path}". Use .pdf, .docx, .html, .txt, .md or .json.`,
    );
  const data = await readFileBytes(path, options);
  const file: AtsFileInfo = { name: basename(path), bytes: data.length, format };
  if (extname(path).toLowerCase() === ".json") {
    const input = parseJsonFile(data, path);
    if (!isResumeDocument(input) && !isJsonResume(input))
      throw new AtsFileError(`${path} is neither a JSON Resume nor an ats-resume document.`);
    return { input: input as AtsResumeInput, file };
  }
  const { text, layout } = await (options?.extract ?? extractResume)(data, format);
  return { input: readableText(text, format), layout, file };
}

/**
 * Text too short to be a resume, refused with the reason: for a PDF that is nearly always a scan
 * or a flattened image, which an ATS cannot read either.
 */
function readableText(text: string, format: string): string {
  if (text.length < 50)
    throw new AtsFileError(
      format === "pdf"
        ? "The PDF has no readable text layer (a scan or a flattened image). An ATS cannot read it either."
        : "The file does not contain enough readable text.",
    );
  return text;
}

/** A job posting read from a file: its text, and the employer when the file names one. */
export type AtsJobFile = { text: string; company?: string };

/**
 * A job posting file's text, normalised as a fetched posting is: a saved `.html` page is read for
 * its posting, a PDF or a Word file the way a resume is, a `.txt` or `.md` file as text. A saved
 * page's JSON-LD names the employer, which `check`'s `jobCompany` leaves out of the keywords.
 */
export async function readJobFile(path: string, options?: AtsReadFileOptions): Promise<AtsJobFile> {
  // A posting's words come back as missing keywords, so any other file (a credentials file, a
  // key) would be echoed to whoever named it: only the types a posting comes in are read.
  if (!/\.(txt|md|html?|pdf|docx)$/i.test(path))
    throw new AtsFileError(
      `Unsupported job posting file type "${extname(path) || path}". Use .txt, .md, .html, .pdf or .docx.`,
    );
  const data = await readFileBytes(path, options);
  if (/\.html?$/i.test(path)) {
    const html = data.toString("utf8");
    const company = extractJobPosting(html)?.company;
    return company ? { text: jobTextFromHtml(html), company } : { text: jobTextFromHtml(html) };
  }
  const format = detectResumeFormat(path);
  const text =
    format === "pdf" || format === "docx"
      ? (await (options?.extract ?? extractResume)(data, format)).text
      : data.toString("utf8");
  return { text: normalizeJobText(text) };
}
