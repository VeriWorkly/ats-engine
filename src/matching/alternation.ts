import type { AtsEnginePolicy } from "../policy/schema.js";
import { memo } from "../util/memo.js";
import { wordListPattern } from "../text/text.js";
import { canonicalize, opensSentence, slashParts, type Vocabulary } from "./vocabulary.js";

const isTermChar = (char: string) => /[\p{L}\p{M}\p{N}+#./-]/u.test(char);

/** Caps the alternatives one "or" binds: a longer comma list is prose, not a choice. */
const MAX_ALTERNATION_MEMBERS = 8;

/** Caps the words of one alternative's name: "Google Cloud Platform". */
const MAX_NAME_WORDS = 3;

const capitalised = (word: string) => /^\p{Lu}/u.test(word);

/** The comma-separated run immediately preceding an "or": "React, Vue, " -> [react, vue]. */
function trailingList(text: string) {
  const tokens: string[] = [];
  let index = text.length;

  // Step over an Oxford comma ("React, Vue, or Angular").
  while (index > 0 && /\s/.test(text[index - 1])) index -= 1;
  if (index > 0 && text[index - 1] === ",") index -= 1;

  while (tokens.length < MAX_ALTERNATION_MEMBERS) {
    while (index > 0 && /\s/.test(text[index - 1])) index -= 1;
    const end = index;
    while (index > 0 && isTermChar(text[index - 1])) index -= 1;
    if (index === end) break;

    tokens.unshift(text.slice(index, end));
    // A capitalised name of several words is one alternative ("Google Cloud or AWS"), but not
    // with the word that opens the line ("Strong Python or Java").
    for (let words = 1; words < MAX_NAME_WORDS && capitalised(tokens[0]!); words += 1) {
      let space = index;
      while (space > 0 && text[space - 1] === " ") space -= 1;
      let start = space;
      while (start > 0 && isTermChar(text[start - 1])) start -= 1;
      const word = text.slice(start, space);
      if (space === index || !capitalised(word) || word.endsWith(".")) break;
      if (opensSentence(text, start)) break;
      tokens.unshift(word);
      index = start;
    }

    let comma = index;
    while (comma > 0 && /\s/.test(text[comma - 1])) comma -= 1;
    if (comma === 0 || text[comma - 1] !== ",") break;
    index = comma - 1;
  }

  return tokens;
}

/**
 * The term immediately following an "or": " Angular and more" -> [angular]. A capitalised name
 * of several words is one alternative: " Google Cloud" -> [google, cloud].
 */
function leadingList(text: string) {
  const tokens: string[] = [];
  let index = 0;
  while (index < text.length && /\s/.test(text[index])) index += 1;
  while (tokens.length < MAX_NAME_WORDS) {
    const start = index;
    while (index < text.length && isTermChar(text[index])) index += 1;
    const word = text.slice(start, index);
    if (!word || (tokens.length && !capitalised(word))) break;
    tokens.push(word);
    // A name goes on only past a space, from a capitalised word that ends no sentence.
    if (!capitalised(word) || word.endsWith(".") || text[index] !== " ") break;
    while (text[index] === " ") index += 1;
  }
  return tokens;
}

/**
 * Groups terms a posting offers as alternatives ("Go or Java", "React, Vue, or Angular"), so the
 * group is satisfied by any one member and counts once. Scanned per line; a term appearing on
 * its own elsewhere joins the same group through the union-find.
 *
 * Only the policy's `alternationWords` ("or", "oder") separate. A slash joins skills asked
 * together ("HTML/CSS"), but beside an "or" each part is an alternative ("Python/Django or Go").
 *
 * Returns the union-find root of a term, and the separator that grouped it, so the missing label
 * can read "Go oder Java".
 */
export function alternationGroups(
  lines: string[],
  km: AtsEnginePolicy["keywordMatch"],
  vocab: Vocabulary,
) {
  const separatorOf = new Map<string, string>();
  const parent = new Map<string, string>();
  const find = (token: string): string => {
    const seen = parent.get(token);
    if (seen === undefined || seen === token) return token;
    const root = find(seen);
    parent.set(token, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const [rootA, rootB] = [find(a), find(b)];
    if (rootA !== rootB) parent.set(rootA, rootB);
  };

  // A term joins at most one group, the first that names it: otherwise a word beside two "or"s
  // ("Java or equivalent", "Python or equivalent") welds unrelated requirements together.
  const grouped = new Set<string>();

  for (const line of lines) {
    // Split, then scan outwards from each "or" by hand: a regex for "comma list then or" nests
    // quantifiers and backtracks badly on a long list without one. The capture keeps the
    // separators: [text, "or", text, "oder", text].
    const parts = line.split(splitterOf(km));
    if (parts.length < 3) continue;

    for (let i = 2; i < parts.length; i += 2) {
      const members = [...trailingList(parts[i - 2]), ...leadingList(parts[i])]
        .flatMap((word) => slashParts(word, vocab).map(([part]) => part))
        .map((word) => canonicalize(word, km, vocab))
        .filter((token): token is string => token !== null && !grouped.has(token));

      for (const member of members) {
        grouped.add(member);
        separatorOf.set(member, parts[i - 1].toLowerCase());
      }
      for (let member = 1; member < members.length; member += 1) union(members[0], members[member]);
    }
  }

  return { find, separatorOf: (token: string) => separatorOf.get(token) };
}

const splitterOf = memo(
  (km: AtsEnginePolicy["keywordMatch"]) =>
    new RegExp(`(${wordListPattern(km.alternationWords)})`, "iu"),
);
