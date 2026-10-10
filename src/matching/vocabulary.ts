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
};

/** A "." or "/" a word picked up from the sentence around it: "JavaScript.", "and/". */
const TRAILING = /(?<![./])[./]+$/;

/** A link, from its scheme on: "https://careers.example.com/jobs/123". Never a skill. */
const LINK = /(?<![\p{L}\p{N}+.-])\p{L}[\p{L}\p{N}+.-]{0,30}:\/\/\S*/gu;

/**
 * The words a token stands for, each with its offset in the token. A slash joins words a
 * posting asks for together ("HTML/CSS", "Python/Django", "C#/.NET"), so each is a word of its
 * own. A term the policy names with its slash ("CI/CD", "TCP/IP") or lists as a stopword
 * ("n/a") stays whole, and so does a token with a part that is no word ("OS/2", "24/7").
 */
export function slashParts(token: string, vocab: Vocabulary): Array<[string, number]> {
  const whole = token.toLowerCase().replace(TRAILING, "");
  if (
    !whole.includes("/") ||
    vocab.slashTerms.has(whole) ||
    vocab.stopwords.has(whole) ||
    !whole.split("/").every((part) => /\p{L}/u.test(part))
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
 * Folds a raw word to the same canonical key `extractVocabulary` would file it under, so
 * alternation detection and term lookup agree on what counts as "the same skill".
 */
export function canonicalize(raw: string, km: AtsEnginePolicy["keywordMatch"], vocab: Vocabulary) {
  const word = raw.toLowerCase().replace(TRAILING, "");
  if (!word || vocab.stopwords.has(word) || vocab.stopwords.has(stem(word, km.stemming)))
    return null;
  const mapped = own(km.synonyms, word) ?? word;
  return mapped.includes(" ") ? mapped : stem(mapped, km.stemming);
}

/** The policy's term maps, folded once per policy (see `memo`). */
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
    slashTerms: new Set(
      [...km.phrases, ...Object.keys(km.synonyms), ...Object.values(km.synonyms)].filter((term) =>
        term.includes("/"),
      ),
    ),
  };

  // Soft skills fold as every term does: "communicating" (a synonym of "communication") and
  // "communications" (stemmed) are the one soft skill.
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

  // Everything else the policy names explicitly — phrases plus both sides of the synonym map —
  // is a known skill by construction. Anything else has to earn the classification at match time.
  for (const phrase of km.phrases) if (!softTokens.has(phrase)) skillTokens.add(phrase);
  for (const [abbreviation, canonical] of Object.entries(km.synonyms)) {
    const token = canonical.includes(" ") ? canonical : stem(canonical, km.stemming);
    // "communicates" stems to the key "communicate", a soft skill's spelling too.
    if (softTokens.has(token)) continue;
    skillTokens.add(stem(abbreviation, km.stemming));
    skillTokens.add(token);
  }

  // Both sides of the implication map are folded through the same canonicalisation the term
  // maps use, so "PostgreSQL" -> "relational database" lines up with whatever spelling the
  // posting happened to use.
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
 * Each phrase's pattern, compiled once. Keyed on the plural-suffix list — the only other input to
 * the pattern — rather than on `keywordMatch`, because the requirements judge passes a copy of
 * it with a filtered phrase list, and that copy shares this array. Recompiling every phrase on
 * every call cost more than the matching: a 400-phrase policy doubled the time of a check.
 */
const phrasesOf = memo<readonly string[], Map<string, RegExp>>(() => new Map());

function phrasePattern(phrase: string, pluralSuffixes: readonly string[]) {
  const patterns = phrasesOf(pluralSuffixes);
  let re = patterns.get(phrase);
  if (!re) {
    // A trailing plural on the last word still refers to the same concept, and postings write
    // it either way ("relational database" / "relational databases"). Without this the phrase
    // fails to match and its words scatter into unrelated single terms.
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
 * synonyms and abbreviations fold to a shared canonical form, and single words are lightly
 * stemmed so inflections line up.
 *
 * Phrase occurrences are consumed *by character span* rather than by word. Suppressing the
 * component words globally meant a resume containing "machine learning" no longer matched a
 * posting that used "learning" and "machine" separately — the words were struck from the whole
 * document because they happened to appear inside a phrase elsewhere in it.
 */
export function extractVocabulary(
  text: string,
  km: AtsEnginePolicy["keywordMatch"],
  vocab: Vocabulary,
) {
  const lower = text.toLowerCase();
  const map = new Map<string, Term>();
  // Character mask marking spans already claimed by a multi-word phrase.
  const claimed = new Uint8Array(lower.length);
  // And the links, where neither a phrase ("a/b" in "https://x.com/a/b") nor a word is read.
  const linked = new Uint8Array(lower.length);
  if (lower.includes("://"))
    for (const link of lower.matchAll(LINK))
      linked.fill(1, link.index, link.index + link[0].length);

  for (const phrase of [...km.phrases, ...vocab.softPhrases]) {
    // Most of a large phrase list is absent from any one text, and a substring test is far
    // cheaper than compiling and running a Unicode-boundary pattern the first time.
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

  // Cloned rather than reused: a module-level /g/ regex carries `lastIndex` across calls.
  const tokenRe = new RegExp(VOCABULARY_TOKEN.source, "gu");
  let match: RegExpExecArray | null;

  // Offsets in `lower` are offsets in `text` only when lower-casing kept the length.
  const sameOffsets = lower.length === text.length;

  while ((match = tokenRe.exec(lower))) {
    if (claimed[match.index] || linked[match.index]) continue;
    for (const [word, offset] of slashParts(match[0], vocab)) addWord(word, match.index + offset);
  }

  function addWord(word: string, index: number) {
    const raw = word.replace(TRAILING, "");
    if (!raw || vocab.stopwords.has(raw) || vocab.stopwords.has(stem(raw, km.stemming))) return;

    // A word of one or two letters is a skill only as one is written: with a capital ("R",
    // "Go", "AI"), and a single letter not followed by a full stop, which makes it an initial
    // ("Jane R. Doe"). Lower case it is ordinary prose: "I go to every meeting". Letters
    // without case (most scripts besides Latin, Greek and Cyrillic) carry no such signal.
    let shortSkill = false;
    if (raw.length <= 2 && /^\p{L}+$/u.test(raw) && raw.toUpperCase() !== raw && sameOffsets) {
      const written = text.slice(index, index + raw.length);
      if (written === raw) return;
      if (raw.length === 1 && word.endsWith(".")) return;
      shortSkill = true;
    }

    const mapped = own(km.synonyms, raw) ?? raw;
    if (mapped.includes(" ")) {
      if (!map.has(mapped))
        map.set(mapped, { token: mapped, label: mapped, skill: !vocab.softTokens.has(mapped) });
      return;
    }
    const token = stem(mapped, km.stemming);
    if (!map.has(token))
      map.set(token, { token, label: raw, skill: shortSkill || vocab.skillTokens.has(token) });
  }

  return map;
}

/**
 * The resume's literal terms plus everything they demonstrate. Matching against this rather
 * than the literal set is what stops the report telling a candidate who listed Terraform that
 * they are missing "infrastructure as code".
 */
export function resumeCapabilities(resumeTerms: Map<string, Term>, vocab: Vocabulary) {
  const capabilities = new Set(resumeTerms.keys());
  for (const token of resumeTerms.keys())
    for (const implied of vocab.implies.get(token) ?? []) capabilities.add(implied);
  return capabilities;
}

/**
 * Tokens written with a capital letter somewhere other than the start of a sentence, plus
 * short all-caps runs. Used as a specificity signal: "Kubernetes", "PostgreSQL", "Go", "AWS"
 * are proper nouns or acronyms and are almost always the actual skill; "payments", "ownership",
 * "familiarity" are not. Cheap and needs no corpus.
 *
 * In a language that capitalises every noun (`nounsCapitalized`, German) a leading capital is
 * no signal at all — "Erfahrung" would rank beside "Kubernetes" — so only acronyms and inner
 * capitals ("PostgreSQL", "JavaScript", "iOS") count there. A script without case gives no
 * signal either way; its specificity comes from the policy's skill vocabulary alone.
 */
export function properNounTokens(originalText: string, nounsCapitalized = false) {
  const proper = new Set<string>();
  const re = /\p{L}[\p{L}\p{M}\p{N}+#./-]*/gu;
  let match: RegExpExecArray | null;

  while ((match = re.exec(originalText))) {
    // A compound and each of its parts ("HTML/CSS", "HTML", "CSS"), whichever the vocabulary
    // reads it as. A part after a slash does not open a sentence, and one written with a
    // capital says the first is a name too: "Java/Kotlin" opening a line names Java.
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
 * Whether the word at `index` opens a sentence or a line. Backs past spaces and list markers to
 * the previous sentence boundary or line break, so an indented bullet ("      - Proficient")
 * still opens a sentence. Reads at most 40 characters back.
 */
export function opensSentence(text: string, index: number) {
  return /(?:^|[.!?:\n])[^\p{L}\p{N}]*$/u.test(text.slice(Math.max(0, index - 40), index));
}
