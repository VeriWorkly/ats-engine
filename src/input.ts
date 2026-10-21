import { fromJsonResume, isJsonResume } from "./document/jsonResume.js";
import { renderResumeDocument } from "./document/render.js";
import { resumeDocumentSchema } from "./document/schema.js";
import { DOCUMENT_LIMITS, isResumeDocument, type AtsResumeDocument } from "./document/types.js";
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
  readonly [PREPARED]: true;
};

// Caller-controlled JSON can nest as deep as a body limit allows: cap the walk against stack overflow.
const MAX_FLATTEN_DEPTH = 24;
const MAX_TEXT_CHARS = 50_000;

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

  if (typeof input === "string") {
    text = input;
  } else if (isResumeDocument(input)) {
    if (isOversized(input))
      throw new AtsInputError("Resume document is too large.", [
        { path: "", message: "Resume document exceeds the size limits." },
      ]);
    document = validDocument(input);
    text = renderResumeDocument(document);
  } else if (isJsonResume(input)) {
    // The adapter's output should validate; if not, the caller gets `AtsInputError`, not a ZodError.
    document = validDocument(fromJsonResume(input));
    text = renderResumeDocument(document);
  } else {
    text = flatten(input);
  }

  // Cut before it is read through, with room for what normalising removes (invisible
  // characters, CR LF), then to the limit.
  const canonical = cut(normalizeText(cut(text, MAX_TEXT_CHARS * 2)).trim(), MAX_TEXT_CHARS);

  return Object.freeze({
    text: canonical,
    // Count what the engine reads: structured inputs are rendered first, so stripped unknown keys cannot smuggle characters.
    hidden: readHiddenCharacters(
      typeof input === "string" ? cut(input, MAX_TEXT_CHARS * 2) : canonical,
    ),
    document,
    [PREPARED]: true as const,
  });
}
