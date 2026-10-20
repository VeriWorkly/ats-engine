/**
 * Characters that change what a resume says without changing how it looks:
 * - zero-width spaces and word joiners split or join keywords;
 * - Unicode tag characters (U+E0000 block) render as nothing but map to ASCII a model reads
 *   ("ASCII smuggling");
 * - bidirectional overrides and isolates reorder what is displayed against what is stored.
 *
 * Zero-width (non-)joiners are legitimate in Indic and Arabic script and emoji; they count only
 * between two Latin letters. A leading U+FEFF is a byte-order mark, neither counted nor stripped.
 */
const INVISIBLE =
  /[\u{200B}\u{2060}-\u{2064}\u{202A}-\u{202E}\u{2066}-\u{2069}]|(?<!^)\u{FEFF}|(?<=\p{Script=Latin})[\u{200C}\u{200D}]+(?=\p{Script=Latin})|[\u{E0000}-\u{E007F}]/gu;

/** An embedding or isolate around a number, as Word writes to keep a phone number left to right. */
const WRAPPED_NUMBER =
  /[\u{202A}\u{202B}\u{2066}-\u{2068}]([\p{N}\p{Zs}+()\-./]*)[\u{202C}\u{2069}]/gu;

const TAG = /[\u{E0000}-\u{E007F}]/gu;

/** As `INVISIBLE`, plus the soft hyphen, which word processors leave behind and is never a trick. */
const STRIP =
  /[\u{00AD}\u{200B}\u{2060}-\u{2064}\u{202A}-\u{202E}\u{2066}-\u{2069}\u{E0000}-\u{E007F}]|(?<=\p{Script=Latin})[\u{200C}\u{200D}]+(?=\p{Script=Latin})|(?<!^)\u{FEFF}/gu;

/** Invisible characters found in a resume's raw text. */
export type HiddenCharacters = {
  /** Invisible characters that do nothing a reader can see. */
  count: number;
  /** What any tag characters spelled out, decoded to ASCII. Empty when there were none. */
  smuggled: string;
};

/** Counts the invisible characters in raw text and decodes any smuggled tag text. */
export function readHiddenCharacters(raw: string): HiddenCharacters {
  const count =
    raw
      .replace(WRAPPED_NUMBER, "$1")
      .match(INVISIBLE)
      ?.reduce((total, match) => total + [...match].length, 0) ?? 0;
  if (count === 0) return { count, smuggled: "" };
  const smuggled = (raw.match(TAG) ?? [])
    .map((char) => char.codePointAt(0)! - 0xe0000)
    .filter((code) => code >= 0x20 && code < 0x7f)
    .map((code) => String.fromCharCode(code))
    .join("");
  return { count, smuggled: smuggled.slice(0, 2_000) };
}

/** The text without them. */
export function stripHiddenCharacters(text: string) {
  return text.replace(STRIP, "");
}
