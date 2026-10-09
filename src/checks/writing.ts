import { findDateRange } from "../parser/dates.js";
import type { ResumeSection } from "../parser/sections.js";
import { policyRegex } from "../policy/regex.js";
import type { AtsEnginePolicy } from "../policy/schema.js";
import {
  BULLET,
  BULLET_PREFIX,
  escapeRegex,
  normalizeText,
  wordListPattern,
} from "../text/text.js";
import { memo } from "../util/memo.js";
import { ANY_YEAR, readsAsSentence } from "./bullets.js";
import { NO_FINDING, quote, type Finding } from "./finding.js";

/**
 * Writing style, as a recruiter reads it once the ATS has stored the resume: bullets in the
 * first person or the passive voice, duties where actions belong, a tense that does not fit the
 * role, bullets too long or too many, the same opening word again and again, dates written two
 * ways. Each check returns null — its rule dropped — when there is nothing for it to judge.
 *
 * The words are the policy's (`writing`); each check reads a line word by word or tests a
 * pattern anchored to one word or to the line's start, so every one is linear in its input.
 */

/** One role in the work history: its dated line, its dates as written, and its bullets. */
export type RoleBlock = { header: string; dates: string; current: boolean; bullets: string[] };

type Writing = AtsEnginePolicy["writing"];

/** A whole word in one of the lists, compiled once per policy. */
const anchored = (list: readonly string[]) => policyRegex(`^(?:${list.join("|")})$`, "i");
const matchers = memo((writing: Writing) => ({
  pronoun: policyRegex(wordListPattern(writing.firstPersonPronouns), "i"),
  auxiliary: anchored(writing.passiveAuxiliaries),
  past: anchored(writing.pastForms),
  adverb: anchored(writing.adverbForms),
  participle: anchored(writing.irregularParticiples),
  pastVerb: anchored(writing.pastTenseVerbs),
  presentVerb: anchored(writing.presentTenseVerbs),
  weakOpener: policyRegex(`^${wordListPattern(writing.weakOpeners)}`, "i"),
}));

/** A bullet without its list marker. */
const body = (line: string) => line.replace(BULLET_PREFIX, "").trim();

/**
 * A token as a word: cut to 40 characters first (no word is longer, and a 50 KB token must not
 * be scanned twice), then without the punctuation around it.
 */
const asWord = (token: string) =>
  token
    .slice(0, 40)
    .replace(/^[^\p{L}\p{N}]+/u, "")
    .replace(/[^\p{L}\p{N}]+$/u, "");

const firstWord = (line: string) => asWord(body(line).slice(0, 60).split(/\s/, 1)[0] ?? "");

/** How many lines `matches`, and the first of them, as a finding; null without lines. */
function countLines(lines: readonly string[], matches: (line: string) => boolean): Finding | null {
  if (!lines.length) return null;
  const found = lines.filter(matches);
  return found.length ? { value: found.length, sample: quote(body(found[0])) } : NO_FINDING;
}

/**
 * The roles of the Experience section, each with the bullets under it until the next dated line.
 * Where the section has list markers the bullets are the marked lines; where extraction lost
 * them, the lines written as sentences (`readsAsSentence`), as `roleBodyLines` reads them. A
 * role's dates and whether it is current are read from its dated line as the parser reads them.
 */
export function roleBlocks(sections: readonly ResumeSection[], policy: AtsEnginePolicy) {
  const lines = sections
    .filter((section) => section.kind === "experience")
    .flatMap((section) => section.lines);
  const marked = lines.some((line) => BULLET.test(line));
  const blocks: RoleBlock[] = [];
  for (const line of lines) {
    const found = BULLET.test(line) ? null : findDateRange(line, policy.resumeParse, ANY_YEAR);
    if (found) {
      const dates = found.matched.trim();
      blocks.push({ header: line, dates, current: found.range.current, bullets: [] });
    } else if (blocks.length && (marked ? BULLET.test(line) : readsAsSentence(line)))
      blocks[blocks.length - 1].bullets.push(body(line));
  }
  return blocks;
}

/** Bullets with a first-person pronoun. */
export function firstPersonLines(lines: readonly string[], policy: AtsEnginePolicy) {
  const { pronoun } = matchers(policy.writing);
  return countLines(lines, (line) => pronoun.test(line));
}

/** Whether a line has an auxiliary followed by a participle, an adverb allowed between. */
function isPassive(line: string, writing: Writing) {
  const m = matchers(writing);
  const words = line.split(/\s+/).map(asWord);
  const participle = (word = "") => m.past.test(word) || m.participle.test(word);
  return words.some(
    (word, at) =>
      m.auxiliary.test(word) &&
      (participle(words[at + 1]) ||
        (m.adverb.test(words[at + 1] ?? "") && participle(words[at + 2]))),
  );
}

/** The share of bullets in the passive voice, and the first of them. */
export function passiveVoice(lines: readonly string[], policy: AtsEnginePolicy): Finding | null {
  const found = countLines(lines, (line) => isPassive(line, policy.writing));
  return found && { value: found.value / lines.length, sample: found.sample };
}

/** Bullets that open with a duty ("Responsible for"). */
export function weakOpeners(lines: readonly string[], policy: AtsEnginePolicy) {
  const { weakOpener } = matchers(policy.writing);
  return countLines(lines, (line) =>
    weakOpener.test(body(line).slice(0, 120).replace(/\s+/g, " ")),
  );
}

/** Bullets longer than the policy's word limit. */
export function longBullets(lines: readonly string[], policy: AtsEnginePolicy) {
  const max = policy.writing.maxBulletWords;
  return countLines(lines, (line) => body(line).split(/\s+/).length > max);
}

/**
 * Bullets whose first verb is in the wrong tense for their role: past in the role held now,
 * present in one that has ended. A bullet opening with a word in neither list ("Payments:", "Cut",
 * a noun) is not judged; with none judged at all, there is nothing to report.
 */
export function tenseMismatches(blocks: readonly RoleBlock[], policy: AtsEnginePolicy) {
  const m = matchers(policy.writing);
  const tenseOf = (line: string) => {
    // "Co-founded" is as past as "founded".
    const word = firstWord(line).split("-").pop() ?? "";
    const past = m.pastVerb.test(word) || m.past.test(word);
    const present = m.presentVerb.test(word);
    return past === present ? null : past ? "past" : "present";
  };
  let judged = 0;
  const wrong: string[] = [];
  for (const block of blocks)
    for (const bullet of block.bullets) {
      const tense = tenseOf(bullet);
      if (!tense) continue;
      judged += 1;
      if (tense === (block.current ? "past" : "present")) wrong.push(bullet);
    }
  if (!judged) return null;
  return wrong.length ? { value: wrong.length, sample: quote(wrong[0]) } : NO_FINDING;
}

/**
 * Roles with fewer or more bullets than the policy's range. A role with none is left out: an
 * early role named in a line is what the length rule advises.
 */
export function bulletsPerRole(blocks: readonly RoleBlock[], policy: AtsEnginePolicy) {
  const { min, max } = policy.writing.bulletsPerRole;
  const counted = blocks.filter((block) => block.bullets.length > 0);
  if (!counted.length) return null;
  const off = counted.filter((block) => block.bullets.length < min || block.bullets.length > max);
  return off.length ? { value: off.length, sample: quote(off[0].header) } : NO_FINDING;
}

/** Runs of bullets in a row, within one role, opening with the same word; the first such word. */
export function repeatedOpeners(blocks: readonly RoleBlock[], policy: AtsEnginePolicy) {
  const run = policy.writing.repeatedOpenerRun;
  if (!blocks.some((block) => block.bullets.length >= run)) return null;
  let runs = 0;
  let sample = "";
  for (const block of blocks) {
    let previous = "";
    let count = 0;
    for (const bullet of block.bullets) {
      const word = firstWord(bullet);
      const key = word.toLowerCase();
      count = key && key === previous ? count + 1 : 1;
      previous = key;
      if (count !== run) continue;
      runs += 1;
      sample ||= word;
    }
  }
  return runs ? { value: runs, sample } : NO_FINDING;
}

/** Month and season names, as words, compiled once per policy. */
const namedMonth = memo((rp: AtsEnginePolicy["resumeParse"]) =>
  policyRegex(
    wordListPattern(
      [...Object.keys(rp.months), ...Object.keys(rp.seasons)].map((name) =>
        escapeRegex(normalizeText(name)),
      ),
    ),
    "i",
  ),
);
const MONTH_YEAR = /(?<!\d)\d{1,2}([./-])\d{4}(?!\d)/u;
const YEAR_MONTH = /(?<!\d)\d{4}([./-])(\d{1,2})(?!\d)/gu;

/**
 * The format family a role's dates are written in: a month by name ("Jan 2020", "Summer 2018"),
 * a month by number in one layout ("03/2021", "2021-03"), or years alone ("2019 – 2021").
 */
function dateFamily(dates: string, policy: AtsEnginePolicy) {
  if (namedMonth(policy.resumeParse).test(dates)) return "named";
  const monthYear = MONTH_YEAR.exec(dates);
  if (monthYear) return `MM${monthYear[1]}YYYY`;
  // "2019-21" is a year range: a month is 12 at most.
  for (const [, separator, month] of dates.matchAll(YEAR_MONTH))
    if (Number(month) >= 1 && Number(month) <= 12) return `YYYY${separator}MM`;
  return "year";
}

/** How many formats the roles' dates are written in, with the first example of two of them. */
export function dateFormats(blocks: readonly RoleBlock[], policy: AtsEnginePolicy) {
  if (blocks.length < 2) return null;
  const families = new Map<string, string>();
  for (const block of blocks) {
    const family = dateFamily(block.dates, policy);
    if (!families.has(family)) families.set(family, block.dates);
  }
  if (families.size < 2) return { value: families.size, sample: "" };
  const examples = [...families.values()].slice(0, 2).map((dates) => `"${quote(dates)}"`);
  return { value: families.size, sample: examples.join(", ") };
}
