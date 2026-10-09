import { readFile, stat } from "node:fs/promises";
import { extname } from "node:path";

import { isJsonResume, isResumeDocument } from "../document/index.js";
import type { AtsResumeInput } from "../input.js";
import { jobTextFromHtml, normalizeJobText } from "../job/index.js";
import { detectResumeFormat, extractResume, type AtsExtraction } from "./extract.js";

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

export type AtsReadFileOptions = {
  /** Refuse a larger file. Default `MAX_FILE_BYTES`. */
  maxBytes?: number;
};

/** A file's bytes, with the usual mistakes — no such file, a folder, too large — named plainly. */
export async function readFileBytes(
  path: string,
  { maxBytes = MAX_FILE_BYTES }: AtsReadFileOptions = {},
): Promise<Buffer> {
  try {
    const info = await stat(path);
    if (info.isDirectory()) throw new AtsFileError(`${path} is a folder, not a file.`);
    if (info.size > maxBytes)
      throw new AtsFileError(
        `${path} is ${size(info.size)}; files over ${size(maxBytes)} are not read.`,
      );
    return await readFile(path);
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
    throw new AtsFileError(`${path} is not valid JSON (${(error as Error).message}).`);
  }
}

/**
 * A resume file as the scorer takes it: the extracted text and, where measurable, its layout; or
 * the document itself for a `.json` JSON Resume or ats-resume document. PDF and DOCX need the
 * optional peers `extractResume` needs.
 */
export async function readResumeFile(
  path: string,
  options?: AtsReadFileOptions,
): Promise<{ input: AtsResumeInput } & Partial<AtsExtraction>> {
  const format = detectResumeFormat(path);
  if (!format)
    throw new AtsFileError(
      `Unsupported resume file type "${extname(path) || path}". Use .pdf, .docx, .html, .txt, .md or .json.`,
    );
  const data = await readFileBytes(path, options);
  if (extname(path).toLowerCase() === ".json") {
    const input = parseJsonFile(data, path);
    if (!isResumeDocument(input) && !isJsonResume(input))
      throw new AtsFileError(`${path} is neither a JSON Resume nor an ats-resume document.`);
    return { input: input as AtsResumeInput };
  }
  const { text, layout } = await extractResume(data, format);
  return { input: readableText(text, format), layout };
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

/**
 * A job posting file's text, normalised as a fetched posting is: a saved `.html` page is read for
 * its posting, a PDF or a Word file the way a resume is, anything else as text.
 */
export async function readJobFile(path: string, options?: AtsReadFileOptions): Promise<string> {
  const data = await readFileBytes(path, options);
  if (/\.html?$/i.test(path)) return jobTextFromHtml(data.toString("utf8"));
  const format = detectResumeFormat(path);
  const text =
    format === "pdf" || format === "docx"
      ? (await extractResume(data, format)).text
      : data.toString("utf8");
  return normalizeJobText(text);
}
