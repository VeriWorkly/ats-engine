import { normalizeText } from "../text/text.js";
import { memo } from "../util/memo.js";

// Grounding checks for the AI parse-repair pass: every value a model returns must occur in the
// source document, so a fabricated employer is detectable. One-directional: it never asks whether
// a value is right, only whether it occurs, which is decidable.

/**
 * Source text folded so matching survives what caused the bad parse (newline-split words,
 * ligatures, doubled spaces). Case is folded too: recasing a present value is repair.
 */
export function normalizeForGrounding(text: string): string {
  // Digits of every script fold to ASCII first, so "2019" grounds in "२०१९" and back. An en or
  // em dash is never part of a word or an address, so it stands apart: "Email—jane@example.com".
  return normalizeText(text)
    .normalize("NFKD")
    .replace(/[–—―]/g, " - ")
    .replace(/[‐-‒−]/g, "-")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/** Letters, marks, digits — and "+" and "#", which tell C, C++ and C# apart. */
const WORD = /[\p{L}\p{M}\p{N}+#]+/gu;

/** Scripts written without spaces between words, where a word run can hold a whole sentence. */
const UNSPACED =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;

/** An email address or a web address: compared as a whole token, never word by word. */
const ADDRESS =
  /^(?:[^\s@]+@[^\s@]+|(?:https?:\/\/|www\.)\S+|[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+\/\S+)$/iu;

/** An address without scheme, "www." and trailing slash. */
const bare = (address: string) =>
  address
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/(?<!\/)\/+$/, "");

/** A bracket, a guillemet or a bullet, which a document glues to an address. */
const MARK = String.raw`[\[\]{}\p{Pi}\p{Pf}•·]`;
const MARKS = new RegExp(`${MARK}+`, "u");
const IS_MARK = new RegExp(`^${MARK}$`, "u");

/** Without marks at its ends: a loop, as `${MARK}+$` rescans a run of marks from each one. */
function trimMarks(text: string) {
  let start = 0;
  let end = text.length;
  while (start < end && IS_MARK.test(text[start]!)) start += 1;
  while (end > start && IS_MARK.test(text[end - 1]!)) end -= 1;
  return text.slice(start, end);
}

/**
 * Without hyphens at its ends ("-jane@example.com"), which no address starts or ends with; a
 * loop, as `-+$` rescans a run of hyphens from each one.
 */
function trimDashes(text: string) {
  let start = 0;
  let end = text.length;
  while (start < end && text[start] === "-") start += 1;
  while (end > start && text[end - 1] === "-") end -= 1;
  return text.slice(start, end);
}

/**
 * The addresses one token may be: as written ("janedoe.dev/[draft]"), and split at the marks
 * before its path, each without marks at its ends ("[janedoe.dev]", "janedoe.dev·github.com/x").
 * A mark inside a path is part of it: "janedoe.dev/a·b" is not "janedoe.dev/a".
 */
function addressesIn(token: string): string[] {
  const path = token.search(/(?<!\/)\/(?!\/)/);
  const pieces = (path === -1 ? token : token.slice(0, path)).split(MARKS);
  if (path !== -1) pieces[pieces.length - 1] += token.slice(path);
  return [token, ...pieces.map(trimMarks)];
}

/** Whether an address occurs in the source as one of its tokens: "github.com/jane" is not "github.com/janedoe". */
function addressGrounded(value: string, normalized: string) {
  const target = bare(value);
  // The source as written and as laid out ("B.Sc / M.Sc", an address broken after "-", "/" or "@").
  // Each reading only adds whole tokens, so neighbouring values never merge.
  const readings = [
    normalized,
    normalized.replace(/ ?\/ ?/g, "/"),
    normalized.replace(/([-/@]) /g, "$1"),
  ];
  return readings.some((text) =>
    text
      // An icon glyph glued to the address separates it like a space.
      .split(/[\s|,;<>()"'\p{So}\p{Co}]+/u)
      .some((token) =>
        addressesIn(token).some(
          (address) =>
            bare(
              trimDashes(
                address
                  // A label ("Email:"), not part of the address; "https://" is kept.
                  .replace(/^\p{L}+:(?!\/\/)/u, "")
                  .replace(/(?<![.:;!?])[.:;!?]+$/, ""),
              ),
            ) === target,
        ),
      ),
  );
}

/** A list separator: a value never spans one it does not write itself ("Acme, Globex" is not "Acme Globex"). */
const SEPARATOR = /[,;|•·]/;
/** A word glued to the next by "&" or "-" ("R&D"). */
const GLUE = /^[&-]$/;
/** What may follow a comma inside one company name ("Acme, Inc."). */
const LEGAL_SUFFIX = new Set(
  "inc llc ltd limited corp co plc gmbh ag kg sa sarl srl bv nv lp llp pty pvt ab as oy".split(" "),
);

type Gaps = { separated: Uint8Array; glued: Uint8Array };
/** For each word, what stands between it and the word before. */
const gapsOf = new WeakMap<readonly string[], Gaps>();

/** The words of a normalised text, in order. Compute once per document and reuse. */
export function groundingWords(normalized: string): string[] {
  const words: string[] = [];
  const separated: number[] = [];
  const glued: number[] = [];
  let end = 0;
  for (const match of normalized.matchAll(WORD)) {
    const gap = words.length ? normalized.slice(end, match.index) : "";
    separated.push(SEPARATOR.test(gap) ? 1 : 0);
    glued.push(GLUE.test(gap) ? 1 : 0);
    words.push(match[0]);
    end = match.index + match[0].length;
  }
  gapsOf.set(words, { separated: Uint8Array.from(separated), glued: Uint8Array.from(glued) });
  return words;
}

/**
 * Whether `value` occurs in the source as a run of whole words: its letters and digits must equal
 * consecutive source words joined together. Whole words, so "Meta" is not in "metadata"; joined,
 * so a word split across a line ("Acme Corp\noration") still grounds. Punctuation and spacing are
 * ignored ("Q&A" matches "q & a"); order and adjacency are not.
 *
 * `normalized` must come from `normalizeForGrounding`. Pass `words` when checking many values
 * against one document, so it is split once.
 */
export function isGrounded(
  value: string,
  normalized: string,
  words: readonly string[] = groundingWords(normalized),
): boolean {
  const folded = normalizeForGrounding(value);
  if (ADDRESS.test(folded)) return addressGrounded(folded, normalized);
  const valueWords = groundingWords(folded);
  const target = valueWords.join("");
  if (!target) return true; // no letters or digits: asserts nothing
  // Unspaced scripts run words together, so there any occurrence counts, not only on word boundaries.
  const { joined, starts, wordAt } = joinedWords(words);
  const anywhere = UNSPACED.test(target);
  const gaps = gapsOf.get(words);
  // Offsets inside the value where it writes a separator itself.
  const ownSeparators = new Set<number>();
  const own = gapsOf.get(valueWords)!;
  valueWords.reduce((offset, word, index) => {
    if (own.separated[index]) ownSeparators.add(offset);
    return offset + word.length;
  }, 0);

  const crossesSeparator = (at: number) => {
    for (let offset = at + 1; offset < at + target.length; offset += 1) {
      const index = wordAt[offset]!;
      if (index < 0 || !gaps!.separated[index] || ownSeparators.has(offset - at)) continue;
      if (!LEGAL_SUFFIX.has(words[index]!)) return true;
    }
    return false;
  };
  // "R" is a skill; the "R" of "R&D" is not. Short values only: "full-stack" is still the same words.
  const glued = (at: number) => {
    const first = wordAt[at]!;
    const next = wordAt[at + target.length]!;
    return Boolean(gaps!.glued[first] || (next >= 0 && gaps!.glued[next]));
  };

  // Most rejected values occur nowhere: the native search rules them out before the scan.
  if (!joined.includes(target)) return false;
  return occurs(joined, target, (at) => {
    if (anywhere) return true;
    if (starts[at] !== 1 || starts[at + target.length] !== 1) return false;
    if (!gaps) return true;
    return !crossesSeparator(at) && !(target.length <= 2 && glued(at));
  });
}

/** The words run together, a mark at each offset where a word starts or the run ends, and the word index starting at each offset (-1 elsewhere). */
const joinedWords = memo((words: readonly string[]) => {
  const joined = words.join("");
  const starts = new Uint8Array(joined.length + 1);
  const wordAt = new Int32Array(joined.length + 1).fill(-1);
  let at = 0;
  words.forEach((word, index) => {
    starts[at] = 1;
    wordAt[at] = index;
    at += word.length;
  });
  starts[at] = 1;
  return { joined, starts, wordAt };
});

/**
 * Whether `target` occurs in `text` at an offset `accept` takes, in linear time (Knuth–Morris–
 * Pratt): the value is model output a prompt-injected resume can steer, so no rescanning.
 */
function occurs(text: string, target: string, accept: (at: number) => boolean) {
  const fallback = new Int32Array(target.length);
  for (let i = 1, k = 0; i < target.length; i += 1) {
    while (k > 0 && target[i] !== target[k]) k = fallback[k - 1];
    if (target[i] === target[k]) k += 1;
    fallback[i] = k;
  }
  for (let i = 0, k = 0; i < text.length; i += 1) {
    while (k > 0 && text[i] !== target[k]) k = fallback[k - 1];
    if (text[i] === target[k]) k += 1;
    if (k === target.length) {
      if (accept(i - k + 1)) return true;
      k = fallback[k - 1];
    }
  }
  return false;
}

/** A value the model returned that does not occur in the source, with where it was found. */
export type GroundingViolation = { path: string; value: string };

/**
 * Every string in `candidate` that does not occur in `source`. `skipPaths` are left unchecked: a
 * field name at any depth ("summary") or a path with `[]` for any index ("skills[].name"). Walks
 * generically, so a new schema field is covered automatically. Numbers and booleans are skipped.
 */
export function findGroundingViolations(
  candidate: unknown,
  source: string,
  skipPaths: readonly string[] = [],
): GroundingViolation[] {
  const normalized = normalizeForGrounding(source);
  const words = groundingWords(normalized);
  const violations: GroundingViolation[] = [];

  const walk = (node: unknown, path: string) => {
    const anyIndex = path.replace(/\[\d+\]/g, "[]");
    if (
      skipPaths.some(
        (skip) =>
          path === skip ||
          anyIndex === skip ||
          path.endsWith(`.${skip}`) ||
          anyIndex.endsWith(`.${skip}`),
      )
    )
      return;

    if (typeof node === "string") {
      // A value of only punctuation asserts nothing true; it is not grounded.
      const empty = node.trim() !== "" && !/[\p{L}\p{N}]/u.test(node);
      if (empty || !isGrounded(node, normalized, words)) violations.push({ path, value: node });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        walk(value, path ? `${path}.${key}` : key);
      }
    }
  };

  walk(candidate, "");
  return violations;
}
