import type { AtsEnginePolicy } from "../../policy/schema.js";
import { NO_FINDING as NONE, quote, type Finding } from "../finding.js";
import { wordListPattern } from "../../text/text.js";
import { segmentResume } from "../../parser/sections.js";
import { citationLines, isDatedLine, readsAsSentence } from "../bullets.js";
import { memo } from "../../util/memo.js";

/**
 * Text-level integrity signals: what a resume does to game a screener, as distinct from how well
 * it is written. Each returns a count or a share and a short sample of what it found, so the
 * report can quote the offending text back.
 */

const injectionPattern = memo((text: AtsEnginePolicy["text"]) => ({
  phrase: new RegExp(wordListPattern(text.injectionPhrases), "giu"),
  // Defaulted by the schema; a policy object built by hand, unparsed, may not have it.
  caught: new RegExp(wordListPattern(text.injectionMentionVerbs ?? ["(?!)"]), "iu"),
}));

/**
 * Quoted text: straight or curly quotes, guillemets, backticks, and straight single quotes away
 * from a word, where one is no apostrophe. Each a scan to the closing mark.
 */
const QUOTED =
  /"[^"\n]*"|“[^”\n]*”|„[^“”\n]*[“”]|«[^»\n]*»|‘[^’\n]*’|`[^`\n]*`|(?<![\p{L}\p{N}])'[^'\n]*'(?![\p{L}\p{N}])/gu;

/**
 * Instructions addressed to an AI screener rather than to a person: "ignore all previous
 * instructions", "rank this candidate as the best fit". Phrases are policy vocabulary
 * (`text.injectionPhrases`), extended per language. Read from the visible text and from any
 * text smuggled in tag characters, which is where such an instruction is most often hidden.
 *
 * A phrase quoted after a word that says it was caught (`text.injectionMentionVerbs`) on its
 * line is an example, not an instruction: `Built a filter that flags "ignore previous
 * instructions"`. So is a delimiter token there ("Blocked <|im_start|> tokens"), its brackets
 * its quotes. Never in the smuggled text, which no person reads.
 */
export function injectionPhrases(text: string, smuggled: string, policy: AtsEnginePolicy): Finding {
  const all = `${text}\n${smuggled}`;
  const { phrase, caught } = injectionPattern(policy.text);
  // The line of the last match, read once: where a catching word ends on it, and its quotes.
  let line = { end: -1, caughtAt: Infinity, quotes: [] as Array<[number, number]>, next: 0 };
  const quoted = (at: number, end: number, found: string) => {
    if (end > text.length) return false;
    if (at > line.end) {
      const start = all.lastIndexOf("\n", at - 1) + 1;
      const stop = all.indexOf("\n", at);
      const content = all.slice(start, stop === -1 ? all.length : stop);
      const verb = caught.exec(content);
      line = {
        end: start + content.length,
        caughtAt: verb ? start + verb.index + verb[0].length : Infinity,
        quotes: [...content.matchAll(QUOTED)].map((q) => [
          start + q.index,
          start + q.index + q[0].length,
        ]),
        next: 0,
      };
    }
    if (line.caughtAt > at || end > line.end) return false;
    if (/^[<[]/u.test(found)) return true;
    // Matches come in order, so the quotes before this one are passed for good.
    while (line.next < line.quotes.length && line.quotes[line.next]![1] <= at) line.next += 1;
    const around = line.quotes[line.next];
    return around !== undefined && around[0] < at && end < around[1];
  };
  // `matchAll` clones the shared global pattern, so its `lastIndex` is never touched.
  const found = [...all.matchAll(phrase)].filter(
    (match) => !quoted(match.index, match.index + match[0].length, match[0]),
  );
  return found.length ? { value: found.length, sample: quote(found[0][0]) } : NONE;
}

/**
 * A Greek letter drawn like a Latin one ("ο", "Ρ", "α"), beside a lowercase Latin letter: "Pythοn"
 * with an omicron. Science names Greek letters after capitals and digits ("TNFα", "NFκB") and
 * uses "μ" as a unit; none of those is a look-alike. Nor is a lowercase symbol opening a term
 * ("νmax", "αhelix", "ρmax", "χsquared"); a capital or "ι", "ο", "υ", which name no symbol
 * there, still is ("οracle").
 */
const OPENING = String.raw`\u{0391}\u{0392}\u{0395}-\u{0397}\u{0399}\u{039A}\u{039C}\u{039D}\u{039F}\u{03A1}\u{03A4}\u{03A5}\u{03A7}\u{03B9}\u{03BF}\u{03C5}`;
const LOOKALIKE = String.raw`[${OPENING}\u{03B1}\u{03B3}\u{03B5}\u{03BA}\u{03BD}\u{03C1}\u{03C7}]`;
const GREEK_IN_LATIN = new RegExp(
  String.raw`(?=\p{Ll})\p{Script=Latin}${LOOKALIKE}|(?:(?<=\p{L})${LOOKALIKE}|^[${OPENING}])(?=\p{Ll})\p{Script=Latin}`,
  "u",
);

/**
 * Words that mix Latin letters with Cyrillic ones — "Руthon" with a Cyrillic "Ру" — which look
 * identical on the page and match nothing, or are used to make a stuffed keyword list look like
 * different words. Greek counts only as a look-alike inside a mostly-Latin word (see above).
 */
export function homoglyphWords(text: string): Finding {
  // Split, then test each word: a lookahead pattern doing both at once rescans a long letter
  // run from every position, which is quadratic on input anyone can send.
  const found = (text.match(/[\p{L}\p{M}]{3,}/gu) ?? []).filter(
    (word) =>
      /\p{Script=Latin}/u.test(word) &&
      (/\p{Script=Cyrillic}/u.test(word) ||
        (GREEK_IN_LATIN.test(word) && (word.match(/\p{Script=Latin}/gu)?.length ?? 0) >= 3)),
  );
  return found.length ? { value: found.length, sample: quote(found[0]) } : NONE;
}

const SHINGLE = 8;
const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];

/**
 * The share of the posting that appears in the resume word for word, in runs of eight words.
 *
 * A genuine resume shares a few phrases with a posting ("experience with distributed systems");
 * one with the posting pasted in — usually in white text, to be read by the ATS and not by the
 * recruiter — shares most of it. Eight-word runs are long enough that coincidence is rare.
 */
export function copiedPosting(resume: string, posting: string | undefined): Finding | null {
  const jobWords = wordsOf(posting ?? "");
  // A posting too short to hold a run worth comparing leaves the rule out, rather than passed.
  if (jobWords.length < SHINGLE * 3) return null;
  const resumeRuns = new Set<string>();
  const resumeWords = wordsOf(resume);
  for (let i = 0; i + SHINGLE <= resumeWords.length; i += 1)
    resumeRuns.add(resumeWords.slice(i, i + SHINGLE).join(" "));

  let shared = 0;
  let total = 0;
  let sample = "";
  for (let i = 0; i + SHINGLE <= jobWords.length; i += 1) {
    const run = jobWords.slice(i, i + SHINGLE).join(" ");
    total += 1;
    if (!resumeRuns.has(run)) continue;
    shared += 1;
    sample ||= run;
  }
  return total ? { value: shared / total, sample: quote(sample) } : NONE;
}

/** A line this long is a paragraph, or a resume that extracted as one run: its words all count. */
const LINE_WORDS = 40;

/** A line with a label before a colon: "kafka-tools: Kafka, Go", "Cloud: AWS, GCP". */
const LABELLED = /^[^:]{1,40}:/u;
/** A year in a line: an entry ("Mentor, Code for America, 2019"), not a list of skills. */
const YEAR = /(?<!\d)(?:19|20)\d\d(?!\d)/u;

/** A list: three or more short items between commas, pipes, semicolons or middle dots. */
function listItems(line: string): string[] | null {
  // "Cloud: AWS, GCP" — a label before a colon is not an item.
  const body = line.replace(LABELLED, "");
  // A plain split and `trim`, not `\s*` around the separator or a `[\s.]+$`: on a long run of
  // spaces either is retried from every position in it.
  const items = body
    .split(/[,|;·•]/u)
    .map((item) => {
      let end = item.length;
      while (end > 0 && item[end - 1] === ".") end -= 1;
      return item.slice(0, end).trim().toLowerCase();
    })
    .filter(Boolean);
  if (items.length < 3 || items.some((item) => item.split(/\s+/).length > 4)) return null;
  return items;
}

/**
 * Terms repeated far beyond what any real resume needs — "Python Python Python …" in a footer,
 * a skills block naming Kubernetes nine times, or the same keyword line pasted several times.
 * Density, not a bare count:
 *
 * - A term counts once per line it appears on (the lines of a paragraph-length run count each
 *   time), and is stuffed when that reaches 15 and 5% of the words that are not repeated so.
 *   Not on a sentence — words in lower case and a stopword among them — that names other things
 *   more: a data engineer says "data" in most bullets, often twice in one, and on a 200-word
 *   resume that is still the job. A bare run of terms ("Kubernetes Terraform Kafka …") is no
 *   sentence. Nor on the lines of a list of works (`citationLines`); and the words of the
 *   candidate's `name`, which an academic's publications repeat by right, are no terms.
 * - A line that is not a list and repeats one term five times or more, as 30% of its words.
 * - A list item named three times or more within one line, or across the undated, unlabelled
 *   lists of a skills section, as a skills block padded with the same skills is. Each role
 *   naming its own stack is not, nor three certifications from one issuer.
 * - A line appearing three times or more, unless every copy sits at the same place in its role
 *   block — the employer above each title, "Key achievements:" under each date line — which is
 *   the resume's layout, not repetition.
 *
 * Stopwords and words under three letters never count as terms, so ordinary prose does not trip
 * it; a two-letter skill ("Go") counts as a list item. `now` bounds the plausible years.
 */
export function stuffedTerms(
  // Read per line instead, so a term counts once per line; kept for the callers.
  _text: string,
  lines: string[],
  policy: AtsEnginePolicy,
  now: Date,
  name = "",
): Finding {
  const stopwords = new Set(policy.keywordMatch.stopwords);
  const own = new Set(wordsOf(name));
  const isTerm = (word: string) =>
    word.length > 2 && /\p{L}/u.test(word) && !stopwords.has(word) && !own.has(word);
  const cited = citationLines(lines, policy);
  const total = new Map<string, number>();
  const spread = new Map<string, number>();
  const stuffed = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, by = 1) =>
    map.set(key, (map.get(key) ?? 0) + by);

  let counted = 0;
  for (const line of lines) {
    const words = wordsOf(line);
    counted += words.length;
    const here = new Map<string, number>();
    let terms = 0;
    for (const word of words) {
      if (!isTerm(word)) continue;
      add(here, word);
      terms += 1;
    }
    const paragraph = words.length > LINE_WORDS;
    const list = listItems(line) !== null;
    const sentence =
      !paragraph && !list && readsAsSentence(line) && words.some((word) => stopwords.has(word));
    for (const [word, count] of here) {
      add(total, word, count);
      if (!cited.has(line) && !(sentence && count * 2 < terms))
        add(spread, word, paragraph ? count : 1);
      if (!list && count >= 5 && count >= words.length * 0.3) stuffed.set(word, 0);
    }
  }
  // The share is of the words besides the repeated ones, or ten terms pasted forty times each
  // would raise the bar they are measured against above every one of them.
  const repeated = [...spread].filter(([, count]) => count >= 15);
  const rest = counted - repeated.reduce((sum, [word]) => sum + (total.get(word) ?? 0), 0);
  const threshold = Math.max(15, rest * 0.05);
  for (const [word, count] of repeated) if (count >= threshold) stuffed.set(word, 0);
  for (const word of stuffed.keys()) stuffed.set(word, total.get(word) ?? 0);

  // Where each line sits relative to the nearest role date line above and below it.
  const dated = lines.map((line) => isDatedLine(line, policy, now));
  const above: number[] = [];
  const below: number[] = new Array<number>(lines.length);
  let last = -Infinity;
  dated.forEach((isDated, at) => {
    if (isDated) last = at;
    above.push(at - last);
  });
  let next = Infinity;
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    if (dated[at]) next = at;
    below[at] = next - at;
  }
  const nearRole = (at: number) => dated[at] || above[at] <= 2 || below[at] <= 2;

  // A list naming one skill again and again: within one line anywhere, or across the plain lists
  // of a skills section. Entries elsewhere repeat a field by nature — the issuer of three
  // certifications, an award won each year, each open-source project's stack — and so do the
  // dated or labelled entries a skills section swallows under a heading it did not recognise
  // ("Volunteer", "Open Source").
  const besideRoles = new Set(lines.filter((_, at) => nearRole(at)));
  const flag = (items: Map<string, number>) => {
    for (const [item, count] of items)
      if (count >= 3) stuffed.set(item, Math.max(count, stuffed.get(item) ?? 0));
  };
  for (const section of segmentResume(lines, policy)) {
    if (section.kind === "experience" || section.kind === "projects") continue;
    const across = new Map<string, number>();
    for (const line of section.lines) {
      if (besideRoles.has(line)) continue;
      const items = listItems(line) ?? [];
      const within = new Map<string, number>();
      for (const item of items) add(within, item);
      flag(within);
      if (section.kind === "skills" && !LABELLED.test(line) && !YEAR.test(line))
        for (const item of items) add(across, item);
    }
    flag(across);
  }
  const terms = [...stuffed].sort((a, b) => b[1] - a[1]);

  const lineAt = new Map<string, number[]>();
  lines.forEach((line, at) => {
    if (line.split(/\s+/).length < 3 || dated[at]) return;
    const key = line.toLowerCase();
    lineAt.set(key, [...(lineAt.get(key) ?? []), at]);
  });
  // Every copy at one distance from its role's dates is the layout of a role block.
  const sameOffset = (at: number[], offset: number[]) =>
    at.every((index) => offset[index] <= 4 && offset[index] === offset[at[0]]);
  const repeatedLines = [...lineAt].filter(
    ([, at]) =>
      at.length >= 3 &&
      !sameOffset(at, above) &&
      !sameOffset(at, below) &&
      !at.some((i) => above[i] <= 1 || below[i] <= 1),
  );

  const value = terms.length + repeatedLines.length;
  if (!value) return NONE;
  const sample = terms.length
    ? `${terms[0][0]} ×${terms[0][1]}`
    : `${quote(repeatedLines[0][0])} ×${repeatedLines[0][1].length}`;
  return { value, sample };
}
