import { fromJsonResume, isJsonResume } from "./document/jsonResume.js";
import { renderResumeDocument } from "./document/render.js";
import { resumeDocumentSchema } from "./document/schema.js";
import {
  ATS_DOCUMENT_FORMAT,
  DOCUMENT_LIMITS,
  isResumeDocument,
  type AtsResumeDocument,
} from "./document/types.js";
import { findName } from "./parser/contact.js";
import { DEFAULT_POLICY } from "./policy/default.js";
import { readHiddenCharacters, type HiddenCharacters } from "./text/characters.js";
import { cut, normalizeText } from "./text/text.js";
import { ENGLISH_ISSUES } from "./util/issues.js";

/**
 * What the engine accepts as a resume:
 * - `string` — plain text, extracted or pasted.
 * - `AtsResumeDocument` — structured data, recognised by its `format` field.
 * - a JSON Resume (jsonresume.org) — recognised by its shape and read as structure.
 * - any other object — flattened to text, keys on their own lines.
 */
export type AtsResumeInput = string | AtsResumeDocument | Record<string, unknown>;

/** Raised when an input claims to be an `AtsResumeDocument` but does not satisfy the format. */
export class AtsInputError extends Error {
  override name = "AtsInputError";

  constructor(
    message: string,
    readonly issues: Array<{ path: string; message: string }>,
  ) {
    super(message);
  }
}

const PREPARED = Symbol("ats-engine.prepared");

/**
 * A resume read once and ready to score; produced only by `prepareResume`. `text` is the
 * canonical text the rules and any AI pass read; `document` the validated structure, if any.
 * Hand the same object to a report and an AI pass instead of walking the input twice.
 */
export type PreparedResume = {
  readonly text: string;
  readonly document: AtsResumeDocument | null;
  /** Invisible characters the raw input carried, counted before `text` dropped them. */
  readonly hidden: HiddenCharacters;
  /** The text ran past 50,000 characters and `text` holds only the first 50,000. */
  readonly truncated: boolean;
  readonly [PREPARED]: true;
};

// Caller-controlled JSON can nest as deep as a body limit allows: cap the walk against stack overflow.
const MAX_FLATTEN_DEPTH = 24;
const MAX_TEXT_CHARS = 50_000;

/** Text normalised at a time: a whole number of lines, unless one line is longer. */
const CHUNK_CHARS = 100_000;
/** The most of a paste read to fill `MAX_TEXT_CHARS`, past what normalising removes. */
const MAX_READ_CHARS = 2_000_000;

/**
 * The first `MAX_TEXT_CHARS` of the text once normalised, and the raw text read for them. Read a
 * chunk at a time until that much is kept: a 40 MB paste is not read through (it took one to two
 * seconds), and invisible characters, which normalising removes, do not use up the cut (100,000
 * of them before a resume left nothing of it). A paste of only those stops at `MAX_READ_CHARS`.
 */
function normalizedHead(text: string) {
  let kept = "";
  let at = 0;
  while (at < text.length && at < MAX_READ_CHARS && kept.trimStart().length < MAX_TEXT_CHARS) {
    let end = at + CHUNK_CHARS;
    if (end < text.length) {
      // At a line's end, so a CR LF or a letter and its accent are normalised together.
      const line = text.lastIndexOf("\n", end - 1);
      end = line >= at ? line + 1 : at + cut(text.slice(at, end), CHUNK_CHARS).length;
    }
    kept += normalizeText(text.slice(at, end));
    at = end;
  }
  const whole = kept.trim();
  const canonical = cut(whole, MAX_TEXT_CHARS);
  // Cut: more was kept than is read, or the paste goes on past the last chunk read.
  const truncated = canonical.length < whole.length || /\S/.test(text.slice(at, at + CHUNK_CHARS));
  return { canonical, read: text.slice(0, at), truncated };
}

/** Keys go on their own line so "experience" reads as a heading. Stops at the text budget. */
function flatten(value: unknown): string {
  const parts: string[] = [];
  let length = 0;

  const walk = (node: unknown, depth: number) => {
    if (length >= MAX_TEXT_CHARS) return;
    if (typeof node === "string") {
      parts.push(node);
      length += node.length + 1;
      return;
    }
    if (depth >= MAX_FLATTEN_DEPTH || !node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, depth + 1);
      return;
    }
    for (const [key, item] of Object.entries(node as Record<string, unknown>)) {
      if (length >= MAX_TEXT_CHARS) return;
      parts.push(key);
      length += key.length + 1;
      walk(item, depth + 1);
    }
  };

  walk(value, 0);
  return parts.join("\n");
}

/**
 * Whether a declared document is too large to validate: an array past every limit, or more nodes
 * than the largest legal document. zod parses each array element before checking the length, so
 * a million empty items would cost seconds of CPU just to be rejected. Walks at most `MAX_NODES`.
 */
const MAX_NODES = 200_000;
const MAX_ARRAY = Math.max(...Object.values(DOCUMENT_LIMITS).filter((n) => n < 1_000));

function isOversized(value: unknown): boolean {
  const stack: unknown[] = [value];
  let nodes = 0;
  while (stack.length) {
    const node = stack.pop();
    if (Array.isArray(node)) {
      if (node.length > MAX_ARRAY) return true;
      for (const item of node) stack.push(item);
    } else if (node && typeof node === "object") {
      // Counted one at a time, never materialised, so a million keys stop at MAX_NODES.
      for (const key in node) {
        if (++nodes > MAX_NODES) return true;
        stack.push((node as Record<string, unknown>)[key]);
      }
    }
    if (++nodes > MAX_NODES) return true;
  }
  return false;
}

/** The document as the schema reads it, or `AtsInputError` naming the first issues. */
function validDocument(input: unknown): AtsResumeDocument {
  const result = resumeDocumentSchema.safeParse(input, ENGLISH_ISSUES);
  if (result.success) return result.data;
  throw new AtsInputError(
    "Resume document is invalid.",
    result.error.issues.slice(0, 20).map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  );
}

/**
 * An object naming the structured format in another spelling or version ("ats-resume@2",
 * "ATS-RESUME@1"): an error, not text read silently in its place.
 */
function isOtherVersion(input: unknown) {
  const format = (input as { format?: unknown } | null)?.format;
  return (
    typeof format === "string" && /^\s*ats-resume/i.test(format) && format !== ATS_DOCUMENT_FORMAT
  );
}

/**
 * The raw strings of the fields a document kept, before the schema cleaned them: the invisible
 * characters cleaning drops still count, and unknown keys, which the schema strips, do not.
 */
function keptStrings(raw: unknown, kept: unknown, out: string[] = []): string[] {
  if (typeof kept === "string") {
    if (typeof raw === "string") out.push(raw);
  } else if (kept && typeof kept === "object" && raw && typeof raw === "object") {
    for (const key of Object.keys(kept))
      keptStrings(
        (raw as Record<string, unknown>)[key],
        (kept as Record<string, unknown>)[key],
        out,
      );
  }
  return out;
}

function isPreparedResume(value: unknown): value is PreparedResume {
  return typeof value === "object" && value !== null && PREPARED in value;
}

/**
 * Reads a resume input once. Throws `AtsInputError` when the input declares the structured
 * format but does not satisfy it; any other shape is accepted.
 */
export function prepareResume(input: unknown): PreparedResume {
  if (isPreparedResume(input)) return input;

  let text: string;
  let document: AtsResumeDocument | null = null;
  // The raw text the engine reads, before invisible characters are dropped from it.
  let raw: string | undefined;

  if (typeof input === "string") {
    text = input;
  } else if (isOtherVersion(input)) {
    throw new AtsInputError("Resume document format is not supported.", [
      { path: "format", message: `Expected "${ATS_DOCUMENT_FORMAT}".` },
    ]);
  } else if (isResumeDocument(input)) {
    if (isOversized(input))
      throw new AtsInputError("Resume document is too large.", [
        { path: "", message: "Resume document exceeds the size limits." },
      ]);
    document = validDocument(input);
    text = renderResumeDocument(document);
    raw = keptStrings(input, document).join("\n");
  } else if (isJsonResume(input)) {
    const json = fromJsonResume(input);
    // A `basics` that is only a string is held to a printed name's checks: not a headline.
    if (typeof input.basics === "string")
      json.basics.name = findName([json.basics.name], DEFAULT_POLICY).name;
    // The adapter's output should validate; if not, the caller gets `AtsInputError`, not a ZodError.
    document = validDocument(json);
    text = renderResumeDocument(document);
    raw = keptStrings(json, document).join("\n");
  } else {
    text = flatten(input);
  }

  const { canonical, read, truncated } = normalizedHead(text);

  return Object.freeze({
    text: canonical,
    truncated,
    hidden: readHiddenCharacters(raw ?? read),
    document,
    [PREPARED]: true as const,
  });
}
