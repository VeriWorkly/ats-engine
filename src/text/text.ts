import { memo } from "../util/memo.js";
import { stripHiddenCharacters } from "./characters.js";

/**
 * A list marker at the start of a line: a symbol glyph, a list number ("1.", "2)") or Word's "o"
 * bullet. Opening brackets, quotes, currency signs and "+" are excluded ("(Contract) Engineer",
 * "$2M", "+1 415"); "." counts only before whitespace (".NET").
 */
const MARKER = String.raw`(?:[^\p{L}\p{N}\s(\[{"'“‘$€£₹+.]|\.(?=\s)|\d{1,2}[.)](?=\s)|o(?=\s))`;
export const BULLET = new RegExp(`^\\s*${MARKER}`, "u");
/** Every leading marker and the space after it, for stripping. */
export const BULLET_PREFIX = new RegExp(`^\\s*(?:${MARKER}\\s*)+`, "u");

/** What a word is made of in any script: letters, combining marks and digits (in a `u` class). */
export const WORD_CHARS = String.raw`\p{L}\p{M}\p{N}`;

/**
 * `\b(?:a|b|c)\b` for words in any script: `\b` is ASCII-only even under the `u` flag, so the
 * lookarounds use Unicode classes (`_` stays a word character). Entries are joined unescaped, so
 * a list may carry small patterns (`sr\.?`). Compile with the `u` flag.
 */
export function wordListPattern(list: readonly string[]) {
  return `(?<![${WORD_CHARS}_])(?:${list.join("|")})(?![${WORD_CHARS}_])`;
}

export function wordListRegex(list: readonly string[], flags = "i") {
  return new RegExp(wordListPattern(list), `${flags}u`);
}

/** The first `max` UTF-16 units, one fewer when the cut would split a surrogate pair. */
export function cut(text: string, max: number) {
  return /[\uD800-\uDBFF]/.test(text.charAt(max - 1)) ? text.slice(0, max - 1) : text.slice(0, max);
}

/** The zero of each non-ASCII decimal-digit block (fullwidth and mathematical fold in NFKC). */
const DIGIT_ZEROS = [
  0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6, 0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66,
  0x0de6, 0x0e50, 0x0ed0, 0x0f20, 0x1040, 0x1090, 0x17e0, 0x1810,
];

function asciiDigit(digit: string) {
  const code = digit.codePointAt(0)!;
  const zero = DIGIT_ZEROS.find((start) => code >= start && code < start + 10);
  return zero === undefined ? digit : String(code - zero);
}

/**
 * Text in the form every pattern is written against: NFKC (ligatures, fullwidth letters,
 * no-break spaces, composed accents), decimal digits of every script as ASCII, and invisible
 * characters removed (`prepareResume` counts them first).
 */
export function normalizeText(text: string) {
  return stripHiddenCharacters(text.normalize("NFKC").replace(/\p{Nd}/gu, asciiDigit));
}

/** The words a length check counts, lower-cased: every run starting with a letter or digit. */
export function words(text: string) {
  return text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{M}\p{N}+#.'’-]*/gu) ?? [];
}

/**
 * Vocabulary tokenizer, used with `exec` for match offsets. Keeps .net, ci/cd, c++, node.js and
 * 2-letter tokens; the call site strips a trailing "." or "/". Any script, on lower-cased text.
 */
export const VOCABULARY_TOKEN = /(?:\.[\p{L}\p{M}\p{N}+#]+|\p{L}[\p{L}\p{M}\p{N}+#./-]*)/gu;

export function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One suffix rule: a word longer than `minLength` ending in `suffix` ends in `replacement`. */
export type StemRule = { suffix: string; minLength: number; replacement: string; unless?: string };

/** The rules as an unfrozen array: V8 walks a frozen one about three times slower. */
const unfrozen = memo((rules: readonly StemRule[]) => [...rules]);

/** Conservative suffix stripper; the first applicable rule (`keywordMatch.stemming`) wins. */
export function stem(word: string, rules: readonly StemRule[]): string {
  for (const { suffix, minLength, replacement, unless } of unfrozen(rules))
    if (word.length > minLength && word.endsWith(suffix) && !(unless && word.endsWith(unless)))
      return word.slice(0, -suffix.length) + replacement;
  return word;
}

/**
 * Fills `{key}` with `values[key]`; `{key|one|other}` picks "one" when the value is 1, else
 * "other".
 */
export function formatTemplate(template: string, values: Record<string, string | number>) {
  return template.replace(
    /\{(\w+)(?:\|([^{}|]*)\|([^{}|]*))?\}/g,
    (match, key: string, one?: string, other?: string) => {
      if (!(key in values)) return match;
      if (one === undefined) return String(values[key]);
      return Number(values[key]) === 1 ? one : (other ?? "");
    },
  );
}

/** A template with every `{key|one|other}` read in its plural. */
export function pluralTemplate(template: string) {
  return template.replace(/\{\w+\|[^{}|]*\|([^{}|]*)\}/g, "$1");
}
