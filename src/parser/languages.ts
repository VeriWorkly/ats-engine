import { CEFR_LEVELS } from "../policy/primitives.js";
import type { AtsEnginePolicy } from "../policy/schema.js";
import { BULLET_PREFIX, escapeRegex, wordListPattern } from "../text/text.js";
import type { AtsCefrLevel, AtsParsedLanguage } from "../types.js";
import { memo } from "../util/memo.js";
import { own } from "../util/own.js";

/**
 * Spoken languages as rows: "English (native), German (B2)" is English at C2 and German at B2.
 *
 * A language is a name the policy lists (`keywordMatch.requirements.languageNames`, keys and
 * values, which the packs extend with "Deutsch", "हिंदी" and the rest), so "Languages: Go, Rust"
 * among the skills names none. Its level is what stands beside it — before it up to the last
 * separator ("fluent German"), after it up to the next ("German (B2)", "German – fließend") — read
 * against the policy's `languageLevels`, or written as a CEFR level. Languages run together with
 * no separator between them ("Fluent in English and Spanish") share the level one of them states.
 */

/** A CEFR level as written: "B2", "c1". Notation, not a word of any language. */
const CEFR_TOKEN = "[abc][12]";
const CEFR_EXACT = /^[abc][12]$/iu;
const SEPARATORS = new Set([",", ";", "|", "/", "•", "·"]);
const MAX_LINE = 400;
const MAX_LEVEL = 60;

type LevelMatchers = {
  /** Every level word or CEFR level, globally. Longer words first, so a phrase wins. */
  any: RegExp;
  /** Each level word whole, to tell which one a match was. */
  words: Array<{ re: RegExp; cefr: AtsCefrLevel }>;
};

const levelsOf = memo((rp: AtsEnginePolicy["resumeParse"]): LevelMatchers => {
  const keys = Object.keys(rp.languageLevels).sort((a, b) => b.length - a.length);
  return {
    any: new RegExp(wordListPattern([...keys, CEFR_TOKEN]), "giu"),
    words: keys.map((key) => ({
      re: new RegExp(`^(?:${key})$`, "iu"),
      cefr: rp.languageLevels[key]!,
    })),
  };
});

type NameMatchers = {
  any: RegExp;
  names: Record<string, string>;
};

const namesOf = memo((r: AtsEnginePolicy["keywordMatch"]["requirements"]): NameMatchers => {
  const names = [...new Set(Object.entries(r.languageNames).flat())]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex);
  return {
    any: new RegExp(wordListPattern(names.length ? names : ["(?!)"]), "giu"),
    names: r.languageNames,
  };
});

/** The CEFR level a matched level word or token stands for. */
function levelOf(matched: string, matchers: LevelMatchers): AtsCefrLevel | null {
  if (CEFR_EXACT.test(matched)) return matched.toUpperCase() as AtsCefrLevel;
  return matchers.words.find(({ re }) => re.test(matched))?.cefr ?? null;
}

/** Every level word and CEFR level in the text, in order. */
function levelsIn(text: string, matchers: LevelMatchers) {
  return [...text.matchAll(matchers.any)].map((match) => match[0]);
}

/** The level stated by words found: an explicit CEFR level first, else the first word's. */
function cefrOfMatches(found: readonly string[], matchers: LevelMatchers): AtsCefrLevel | null {
  const token = found.find((word) => CEFR_EXACT.test(word));
  if (token) return token.toUpperCase() as AtsCefrLevel;
  for (const word of found) {
    const level = levelOf(word, matchers);
    if (level) return level;
  }
  return null;
}

/** The CEFR level a piece of text states — "fluent", "Muttersprache", "B2" — or null. */
export function cefrLevel(text: string, policy: AtsEnginePolicy): AtsCefrLevel | null {
  const matchers = levelsOf(policy.resumeParse);
  return cefrOfMatches(levelsIn(text, matchers), matchers);
}

/** The order of two CEFR levels: negative when `a` is below `b`. */
export const compareCefr = (a: AtsCefrLevel, b: AtsCefrLevel) =>
  CEFR_LEVELS.indexOf(a) - CEFR_LEVELS.indexOf(b);

/** A language's name as the policy keys it, in English: "Deutsch" → "german". */
export function canonicalLanguage(name: string, policy: AtsEnginePolicy) {
  const lower = name.toLowerCase();
  return own(policy.keywordMatch.requirements.languageNames, lower) ?? lower;
}

/** A level as a row reports it: the words found, or failing those a bracket's words. */
function levelText(found: readonly string[], suffix: string) {
  if (found.length) return found.join(", ").slice(0, MAX_LEVEL);
  const bracket = /^\s*[([]([^()[\]]{1,60})[)\]]/u.exec(suffix);
  return bracket ? bracket[1]!.trim() : "";
}

/** Where the next separator outside brackets stands in `text`, or -1. */
function separatorAt(text: string, fromEnd: boolean) {
  let depth = 0;
  const at = (i: number) => {
    const char = text[i]!;
    if (char === "(" || char === "[") depth += fromEnd ? -1 : 1;
    else if (char === ")" || char === "]") depth += fromEnd ? 1 : -1;
    depth = Math.max(depth, 0);
    return depth === 0 && SEPARATORS.has(char);
  };
  if (fromEnd) {
    for (let i = text.length - 1; i >= 0; i -= 1) if (at(i)) return i;
  } else for (let i = 0; i < text.length; i += 1) if (at(i)) return i;
  return -1;
}

/**
 * The languages one line names, each with the level beside it. A line naming none gives none;
 * a line that is only a level ("Native or bilingual proficiency", which LinkedIn prints under the
 * language) comes back as `levelOnly`.
 */
export function readLanguages(
  line: string,
  policy: AtsEnginePolicy,
): { rows: AtsParsedLanguage[]; levelOnly: { level: string; cefr: AtsCefrLevel } | null } {
  const body = line.replace(BULLET_PREFIX, "").trim().slice(0, MAX_LINE);
  const levels = levelsOf(policy.resumeParse);
  const { any } = namesOf(policy.keywordMatch.requirements);
  const named = [...body.matchAll(any)];
  if (!named.length) {
    const found = levelsIn(body, levels);
    const cefr = cefrOfMatches(found, levels);
    // Only a line that is nothing but its level: not a sentence that happens to hold "basic".
    const rest = found.reduce((out, word) => out.replace(word, ""), body);
    return {
      rows: [],
      levelOnly: cefr && !/\p{L}{3}/u.test(rest) ? { level: levelText(found, ""), cefr } : null,
    };
  }

  // Each language's own text: from the last separator before it, and to the next after it.
  const entries = named.map((match, i) => {
    const start = match.index;
    const end = start + match[0].length;
    const previousEnd = i ? named[i - 1]!.index + named[i - 1]![0].length : 0;
    const nextStart = named[i + 1]?.index ?? body.length;
    const before = body.slice(previousEnd, start);
    const after = body.slice(end, nextStart);
    const cutBefore = i ? separatorAt(before, true) : -1;
    const cutAfter = separatorAt(after, false);
    const prefix = i && cutBefore === -1 ? "" : before.slice(cutBefore + 1);
    const suffix = cutAfter === -1 ? after : after.slice(0, cutAfter);
    const found = [...levelsIn(prefix, levels), ...levelsIn(suffix, levels)];
    return {
      language: match[0],
      found,
      suffix,
      // Joined to the language before it, with no separator between: one clause.
      joined: i > 0 && separatorAt(before, false) === -1,
    };
  });

  // A clause's languages share the level one of them states.
  const rows: AtsParsedLanguage[] = [];
  let clause: typeof entries = [];
  const flush = () => {
    const shared = clause.find((entry) => entry.found.length);
    for (const entry of clause) {
      const own = entry.found.length ? entry : shared;
      rows.push({
        language: entry.language,
        level: own ? levelText(own.found, own.suffix) : levelText([], entry.suffix),
        cefr: own ? cefrOfMatches(own.found, levels) : null,
      });
    }
    clause = [];
  };
  for (const entry of entries) {
    if (!entry.joined) flush();
    clause.push(entry);
  }
  flush();
  return { rows, levelOnly: null };
}

/**
 * The rows of the lines given — a Languages section, or a "Languages:" line — each language once:
 * where it is named twice, the reading that states a level is kept. A line that is only a level
 * gives it to the language above it that has none.
 */
export function parseSpokenLanguages(
  lines: readonly string[],
  policy: AtsEnginePolicy,
  into: AtsParsedLanguage[] = [],
): AtsParsedLanguage[] {
  const at = new Map(into.map((row, index) => [canonicalLanguage(row.language, policy), index]));
  let last: AtsParsedLanguage | null = null;
  for (const line of lines) {
    const { rows, levelOnly } = readLanguages(line, policy);
    if (levelOnly) {
      if (last && !last.level) Object.assign(last, levelOnly);
      continue;
    }
    for (const row of rows) {
      const key = canonicalLanguage(row.language, policy);
      const seen = at.get(key);
      if (seen === undefined) {
        at.set(key, into.length);
        into.push(row);
        last = row;
      } else {
        const kept = into[seen]!;
        if (!kept.cefr && row.cefr) into[seen] = { ...kept, level: row.level, cefr: row.cefr };
        last = into[seen]!;
      }
    }
  }
  return into;
}
