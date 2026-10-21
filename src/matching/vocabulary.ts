import type { AtsEnginePolicy } from "../policy/schema.js";
import { memo } from "../util/memo.js";
import { own } from "../util/own.js";
import { VOCABULARY_TOKEN, WORD_CHARS, escapeRegex, stem } from "../text/text.js";

export type Term = { token: string; label: string; skill: boolean };

export type Vocabulary = {
  /** Stopwords stored both raw and stemmed, so "experiences" is filtered like "experience". */
  stopwords: Set<string>;
  /** Canonical tokens the policy explicitly recognises as (hard) skills. */
  skillTokens: Set<string>;
  /** Canonical tokens of the policy's soft skills; never in `skillTokens`. */
  softTokens: Set<string>;
  /** The multi-word soft skills `phrases` does not name, matched as phrases too. */
  softPhrases: string[];
  /** Canonical skill -> canonical capabilities it demonstrates. Resume side only. */
  implies: Map<string, string[]>;
  /** The terms the policy writes with a slash ("ci/cd", "tcp/ip"): never split. */
  slashTerms: Set<string>;
  /** Skills the policy spells as their own stem ("react", "spark"): no verb folds onto one. */
  namedSkills: Set<string>;
};

/**
 * A word's token: its stem, unless a verb's ending folded it onto a named skill ("reacted" onto
 * "react", "sparked" onto "spark"), where the word stays itself. A plural still folds ("apis").
 */
function fold(word: string, km: AtsEnginePolicy["keywordMatch"], vocab: Vocabulary) {
  const token = stem(word, km.stemming);
  return token !== word &&
    vocab.namedSkills.has(token) &&
    !km.pluralSuffixes.some((suffix) => word === token + suffix)
    ? word
    : token;
}

/** A "." or "/" a word picked up from the sentence around it: "JavaScript.", "and/". */
const TRAILING = /(?<![./])[./]+$/;

/**
 * A link, from its scheme on ("https://careers.example.com/jobs/123"), or from "www." or a host
 * of three labels or more ending in one of `linkDomains`. Never a skill; "Node.js/React" and
 * "System.Text.Json" are not links. Linear: a host starts only where a label starts, and is at
 * most eight labels of 63 characters.
 */
const linkOf = memo(
  (km: AtsEnginePolicy["keywordMatch"]) =>
    new RegExp(
      String.raw`(?<![\p{L}\p{N}+.-])\p{L}[\p{L}\p{N}+.-]{0,30}:\/\/\S*|(?<![\p{L}\p{N}+.@/-])(?:www\.(?:[\p{L}\p{N}-]{1,63}\.){0,7}\p{L}{2,63}|(?:[\p{L}\p{N}-]{1,63}\.){2,8}(?:${(km.linkDomains ?? []).join("|") || "(?!)"}))(?![\p{L}\p{N}-])(?:\/\S*)?`,
      "gu",
    ),
);

/**
 * The words a token stands for, each with its offset in the token. A slash joins words asked
 * together ("HTML/CSS"), so each is a word of its own. A term the policy names with its slash
 * ("CI/CD") or lists as a stopword ("n/a") stays whole, as does a token with a part that is no
 * word ("OS/2", "24/7") or opens with a digit ("S/4HANA").
 */
export function slashParts(token: string, vocab: Vocabulary): Array<[string, number]> {
  const whole = token.toLowerCase().replace(TRAILING, "");
  if (
    !whole.includes("/") ||
    vocab.slashTerms.has(whole) ||
    vocab.stopwords.has(whole) ||
    !whole.split("/").every((part) => /\p{L}/u.test(part) && !/^\p{N}/u.test(part))
  )
    return [[token, 0]];
  const parts: Array<[string, number]> = [];
  let at = 0;
  for (const part of token.split("/")) {
    if (part) parts.push([part, at]);
    at += part.length + 1;
  }
  return parts;
}

/**
 * Folds a raw word to the canonical key `extractVocabulary` files it under, or null for a stopword.
 */
export function canonicalize(raw: string, km: AtsEnginePolicy["keywordMatch"], vocab: Vocabulary) {
  const word = raw.toLowerCase().replace(TRAILING, "");
  if (!word || vocab.stopwords.has(word) || vocab.stopwords.has(stem(word, km.stemming)))
    return null;
  const mapped = own(km.synonyms, word) ?? word;
  return mapped.includes(" ") ? mapped : fold(mapped, km, vocab);
}

/** The policy's term maps, folded once per policy. */
export const buildVocabulary = memo((km: AtsEnginePolicy["keywordMatch"]): Vocabulary => {
  const stopwords = new Set<string>();
  // A number word ("five years") is part of a years ask, never a keyword of its own.
  for (const word of [...km.stopwords, ...Object.keys(km.numberWords)]) {
    stopwords.add(word);
    stopwords.add(stem(word, km.stemming));
  }

  const skillTokens = new Set<string>();
  const softTokens = new Set<string>();
  const vocabulary: Vocabulary = {
    stopwords,
    skillTokens,
    softTokens,
    softPhrases: [],
    implies: new Map(),
    namedSkills: new Set(),
    slashTerms: new Set(
      [...km.phrases, ...Object.keys(km.synonyms), ...Object.values(km.synonyms)].filter((term) =>
        term.includes("/"),
      ),
    ),
  };

  // Soft skills fold as every term does, so "communicating" and "communications" are one.
  const phrases = new Set(km.phrases);
  for (const skill of km.softSkills) {
    const token = canonicalize(skill, km, vocabulary);
    if (!token) continue;
    softTokens.add(token);
    if (token.includes(" ") && !phrases.has(token)) {
      phrases.add(token);
      vocabulary.softPhrases.push(token);
    }
  }

  // Everything else the policy names (phrases, both sides of the synonym map) is a known skill.
  for (const phrase of km.phrases) if (!softTokens.has(phrase)) skillTokens.add(phrase);
  for (const [abbreviation, canonical] of Object.entries(km.synonyms)) {
    const token = canonical.includes(" ") ? canonical : stem(canonical, km.stemming);
    // "communicates" stems to "communicate", a soft skill's spelling too.
    if (softTokens.has(token)) continue;
    skillTokens.add(stem(abbreviation, km.stemming));
    skillTokens.add(token);
  }
  for (const spelling of [
    ...km.phrases,
    ...Object.keys(km.synonyms),
    ...Object.values(km.synonyms),
  ])
    if (skillTokens.has(spelling) && stem(spelling, km.stemming) === spelling)
      vocabulary.namedSkills.add(spelling);

  // Both sides of the implication map are canonicalised like the term maps.
  for (const [skill, capabilities] of Object.entries(km.implies)) {
    const from = canonicalize(skill, km, vocabulary);
    if (!from) continue;
    const to = capabilities
      .map((capability) => canonicalize(capability, km, vocabulary))
      .filter((token): token is string => Boolean(token));
    if (to.length) vocabulary.implies.set(from, to);
  }
  return vocabulary;
});

/**
 * Each phrase's pattern, compiled once. Keyed on the plural-suffix list, not `keywordMatch`: the
 * requirements judge passes a copy with a filtered phrase list that shares this array.
 */
const phrasesOf = memo<readonly string[], Map<string, RegExp>>(() => new Map());

function phrasePattern(phrase: string, pluralSuffixes: readonly string[]) {
  const patterns = phrasesOf(pluralSuffixes);
  let re = patterns.get(phrase);
  if (!re) {
    // A trailing plural on the last word is the same concept ("relational databases").
    re = new RegExp(
      `(?<![${WORD_CHARS}_])${escapeRegex(phrase)}(?:${pluralSuffixes.join("|")})?(?![${WORD_CHARS}_])`,
      "giu",
    );
    patterns.set(phrase, re);
  }
  // Shared and global: every use starts from the beginning.
  re.lastIndex = 0;
  return re;
}

/**
 * Maps text to canonical term -> term metadata. Multi-word skills collapse to one token,
 * synonyms fold to a canonical form, single words are lightly stemmed. Phrase occurrences are
 * consumed by character span, not by word, so "learning" still matches outside "machine learning".
 */
export function extractVocabulary(
  text: string,
  km: AtsEnginePolicy["keywordMatch"],
  vocab: Vocabulary,
) {
  const lower = text.toLowerCase();
  const map = new Map<string, Term>();
  // Spans already claimed by a multi-word phrase.
  const claimed = new Uint8Array(lower.length);
  // Links, where neither a phrase nor a word is read.
  const linked = new Uint8Array(lower.length);
  if (lower.includes("."))
    for (const link of lower.matchAll(linkOf(km)))
      linked.fill(1, link.index, link.index + link[0].length);

  for (const phrase of [...km.phrases, ...vocab.softPhrases]) {
    // Most phrases are absent: a substring test is far cheaper than a Unicode-boundary pattern.
    if (!lower.includes(phrase.toLowerCase())) continue;
    const re = phrasePattern(phrase, km.pluralSuffixes);
    let match: RegExpExecArray | null;
    while ((match = re.exec(lower))) {
      if (linked[match.index]) continue;
      map.set(phrase, { token: phrase, label: phrase, skill: !vocab.softTokens.has(phrase) });
      claimed.fill(1, match.index, match.index + match[0].length);
      if (match.index === re.lastIndex) re.lastIndex += 1;
    }
  }

  // Cloned: a module-level /g/ regex carries `lastIndex` across calls.
  const tokenRe = new RegExp(VOCABULARY_TOKEN.source, "gu");
  let match: RegExpExecArray | null;

  // Offsets in `lower` are offsets in `text` only if lower-casing kept the length.
  const sameOffsets = lower.length === text.length;

  while ((match = tokenRe.exec(lower))) {
    if (claimed[match.index] || linked[match.index]) continue;
    for (const [word, offset] of slashParts(match[0], vocab)) addWord(word, match.index + offset);
  }

  function addWord(word: string, index: number) {
    const raw = word.replace(TRAILING, "");
    if (!raw || vocab.stopwords.has(raw) || vocab.stopwords.has(stem(raw, km.stemming))) return;

    // A one- or two-letter word is a skill only with a capital ("R", "Go", "AI"), and a single
    // letter only without a full stop ("Jane R. Doe" is an initial). Uncased scripts carry no
    // such signal.
    let shortSkill = false;
    if (raw.length <= 2 && /^\p{L}+$/u.test(raw) && raw.toUpperCase() !== raw && sameOffsets) {
      const written = text.slice(index, index + raw.length);
      if (written === raw) return;
      if (raw.length === 1 && word.endsWith(".")) return;
      // "R&D", "Q&A": a letter glued to another by "&" is part of a word, not the skill R.
      if (text[index - 1] === "&" || text[index + raw.length] === "&") return;
      shortSkill = true;
    }

    const mapped = own(km.synonyms, raw) ?? raw;
    if (mapped.includes(" ")) {
      if (!map.has(mapped))
        map.set(mapped, { token: mapped, label: mapped, skill: !vocab.softTokens.has(mapped) });
      return;
    }
    const token = fold(mapped, km, vocab);
    if (!map.has(token))
      map.set(token, { token, label: raw, skill: shortSkill || vocab.skillTokens.has(token) });
  }

  return map;
}

/** The resume's literal terms plus everything they imply (Terraform: "infrastructure as code"). */
export function resumeCapabilities(resumeTerms: Map<string, Term>, vocab: Vocabulary) {
  const capabilities = new Set(resumeTerms.keys());
  for (const token of resumeTerms.keys())
    for (const implied of vocab.implies.get(token) ?? []) capabilities.add(implied);
  return capabilities;
}

/**
 * Tokens written with a capital letter other than at the start of a sentence, plus short all-caps
 * runs: a specificity signal ("Kubernetes", "PostgreSQL", "AWS" are almost always the skill).
 * Where every noun is capitalised (`nounsCapitalized`), only acronyms and inner capitals
 * ("PostgreSQL", "iOS") count; an uncased script gives no signal.
 */
export function properNounTokens(originalText: string, nounsCapitalized = false) {
  const proper = new Set<string>();
  const re = /\p{L}[\p{L}\p{M}\p{N}+#./-]*/gu;
  let match: RegExpExecArray | null;

  while ((match = re.exec(originalText))) {
    // A compound and each of its parts ("HTML/CSS", "HTML", "CSS"). A part after a slash does not
    // open a sentence, and a capitalised one says the first is a name too ("Java/Kotlin").
    const parts = match[0].includes("/") ? [match[0], ...match[0].split("/")] : [match[0]];
    const named =
      !opensSentence(originalText, match.index) ||
      parts.slice(2).some((part) => /^\p{Lu}/u.test(part));
    parts.forEach((token, part) => {
      const acronym = /^[\p{Lu}\p{N}+#.]{2,6}$/u.test(token);
      const innerCapital = /\p{Ll}\p{Lu}/u.test(token);
      const capitalised = !nounsCapitalized && /^\p{Lu}/u.test(token) && (part > 1 || named);

      if (acronym || innerCapital || capitalised)
        proper.add(token.toLowerCase().replace(TRAILING, ""));
    });
  }
  return proper;
}

/**
 * Whether the word at `index` opens a sentence or a line, looking back at most 40 characters past
 * spaces and list markers.
 */
export function opensSentence(text: string, index: number) {
  return /(?:^|[.!?:\n])[^\p{L}\p{N}]*$/u.test(text.slice(Math.max(0, index - 40), index));
}
