import type { AtsEnginePolicy } from "../policy/schema.js";
import { BULLET, VOCABULARY_TOKEN } from "../text/text.js";
import type { JobSection } from "./jobSections.js";
import { canonicalize, extractVocabulary, opensSentence, type Vocabulary } from "./vocabulary.js";

/**
 * Terms a posting writes only as names: always capitalised, at least once mid-sentence, only in
 * its prose, never in a list, and not in the policy's vocabulary. "At Freightways, we ship from
 * our Harbor Point depot" names the employer and a place; a skill the role asks for is listed,
 * known to the policy, or written in lowercase somewhere.
 *
 * A list line is a bullet or any line under a required or preferred heading. A prose line is any
 * other line with a word in lowercase, so a title ("Senior Platform Engineer") or a label counts
 * with the lists and keeps its words. A posting with fewer than `minListLines` list lines gives
 * nothing to compare with and keeps every word. Off where a capital says nothing about a name: a
 * language that capitalises every noun, or one whose pack turns it off.
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
  const re = new RegExp(VOCABULARY_TOKEN.source, "gu");
  let match: RegExpExecArray | null;
  while ((match = re.exec(prose))) {
    const raw = match[0].replace(/(?<![./])[./]+$/, "");
    const token = canonicalize(raw, km, vocab);
    if (!token) continue;
    // Only a plain capitalised word is a name; "PostgreSQL", "AWS" and "C++" are skills' shapes.
    if (!/^\p{Lu}[\p{Ll}\p{M}]+$/u.test(raw)) kept.add(token);
    else if (!opensSentence(prose, match.index)) names.add(token);
  }
  for (const token of names)
    if (kept.has(token) || vocab.skillTokens.has(token) || vocab.implies.has(token))
      names.delete(token);
  return names;
}
