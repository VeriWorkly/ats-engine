import type { AtsEnginePolicy } from "../policy/schema.js";
import { BULLET, VOCABULARY_TOKEN } from "../text/text.js";
import type { JobSection } from "./jobSections.js";
import {
  canonicalize,
  extractVocabulary,
  opensSentence,
  TRAILING,
  type Vocabulary,
} from "./vocabulary.js";

/**
 * Terms a posting writes only as names: always capitalised, at least once mid-sentence, only in
 * its prose, never in a list, and not in the policy's vocabulary ("At Freightways, we ship from
 * our Harbor Point depot").
 *
 * A list line is a bullet or any line under a required or preferred heading. A prose line is any
 * other line with a lowercase word, so a title counts with the lists and keeps its words. Fewer
 * than `minListLines` list lines gives nothing to compare with and keeps every word. Off where a
 * capital says nothing about a name (a language that capitalises every noun, or a pack that
 * turns it off).
 */
export function proseNames(
  sections: readonly JobSection[],
  km: AtsEnginePolicy["keywordMatch"],
  vocab: Vocabulary,
): Set<string> {
  const names = new Set<string>();
  if (!km.proseNames.enabled || km.nounsCapitalized) return names;

  let prose = "";
  let listed = "";
  let lists = 0;
  for (const { kind, text } of sections) {
    if (kind === "excluded") continue;
    for (const line of text.split("\n")) {
      const list = kind === "required" || kind === "preferred" || BULLET.test(line);
      if (list && line.trim()) lists++;
      if (!list && /(?<![\p{L}\p{M}\p{N}])\p{Ll}/u.test(line)) prose += `${line}\n`;
      else listed += `${line}\n`;
    }
  }
  if (lists < km.proseNames.minListLines) return names;

  const kept = new Set(extractVocabulary(listed, km, vocab).keys());
  const tools = new Set(vocab.skillTokens);
  for (const skill of km.proseNames.skills) {
    const token = canonicalize(skill, km, vocab);
    if (token) kept.add(token);
    if (token) tools.add(token);
  }
  const tool = (word: string) => tools.has(canonicalize(word, km, vocab) ?? "");
  const cues = new Set(km.proseNames.cues);
  const re = new RegExp(VOCABULARY_TOKEN.source, "gu");
  let match: RegExpExecArray | null;
  while ((match = re.exec(prose))) {
    const raw = match[0].replace(TRAILING, "");
    const token = canonicalize(raw, km, vocab);
    if (!token) continue;
    // Only a plain capitalised word is a name; "PostgreSQL", "AWS" and "C++" are skills' shapes.
    if (!PLAIN_CAPITAL.test(raw)) kept.add(token);
    else if (!opensSentence(prose, match.index) && namedAt(prose, match.index, raw, cues, tool))
      names.add(token);
    // Written once without a name's signs ("written in Rust"): not only a name.
    else if (!opensSentence(prose, match.index)) kept.add(token);
  }
  for (const token of names)
    if (kept.has(token) || vocab.skillTokens.has(token) || vocab.implies.has(token))
      names.delete(token);
  return names;
}

const PLAIN_CAPITAL = /^\p{Lu}[\p{Ll}\p{M}]+$/u;
/** The word before a position on its line, past spaces only; the word after an end. */
const BEFORE = /([\p{L}\p{M}]+)[ \t]+$/u;
const AFTER = /^[ \t]+([\p{L}\p{M}]+)/u;

/**
 * Whether the capitalised word at `index` is written as a name: beside another capitalised word
 * that does not open the sentence ("Harbor Point"; "Using Rust" is no name), or after a cue
 * ("At Freightways"). Never after a tool the policy knows: that names its product ("Apache
 * Pulsar", "Snowflake Cortex").
 */
function namedAt(
  prose: string,
  index: number,
  raw: string,
  cues: ReadonlySet<string>,
  tool: (word: string) => boolean,
) {
  const head = prose.slice(Math.max(0, index - 40), index);
  const before = BEFORE.exec(head)?.[1];
  const after = AFTER.exec(prose.slice(index + raw.length, index + raw.length + 40))?.[1];
  if (before && tool(before)) return false;
  if (before && cues.has(before.toLowerCase())) return true;
  if (after && PLAIN_CAPITAL.test(after)) return true;
  return Boolean(
    before &&
    PLAIN_CAPITAL.test(before) &&
    !opensSentence(prose, index - head.length + head.lastIndexOf(before)),
  );
}
