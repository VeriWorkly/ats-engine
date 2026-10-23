import { isDatedLine, readsAsSentence } from "../checks/bullets.js";
import { formatCertification, formatSpokenLanguage, ISCED_LABELS } from "../format/index.js";
import { statesExpiry } from "../parser/certifications.js";
import { degreeLevels } from "../parser/education.js";
import { namesPlace, roleDates } from "../parser/experience.js";
import { isWrittenIn, sampleOf, showsAny } from "../locales/languages.js";
import { canonicalLanguage, cefrLevel, compareCefr } from "../parser/languages.js";
import { monthsOfExperience } from "../parser/tenure.js";
import { labelledLine, type ResumeSection, type ResumeSectionKind } from "../parser/sections.js";
import { policyRegex } from "../policy/regex.js";
import type { AtsEnginePolicy } from "../policy/schema.js";
import type { AtsCefrLevel, AtsParsedResume, AtsRequirement } from "../types.js";
import { memo } from "../util/memo.js";
import { own } from "../util/own.js";
import { alternationGroups } from "./alternation.js";
import { isOfferLine, segmentJob, withoutIgnored } from "./jobSections.js";
import {
  BULLET,
  BULLET_PREFIX,
  escapeRegex,
  wordListPattern,
  wordListRegex,
} from "../text/text.js";
import {
  buildVocabulary,
  canonicalize,
  extractVocabulary,
  isSkillItem,
  properNounTokens,
  resumeCapabilities,
} from "./vocabulary.js";

// The posting's requirements, one by one, judged against the resume: each requirement under the
// Requirements or Preferred heading, its status, the terms it names and the resume lines that
// evidence it. Deterministic; no model is involved.

const MAX_REQUIREMENTS = 25;
const MAX_REQUIREMENT_CHARS = 300;
const MAX_EVIDENCE = 2;
const MAX_TERMS = 6;
/** Lines searched for evidence. */
const MAX_EVIDENCE_LINES = 1_000;
/** Years of dated work that let "or equivalent experience" stand in for a degree. */
const EQUIVALENT_MONTHS = 24;
const WEAK_LANGUAGE = /\b(?:beginner|basic|elementary|limited|a1|a2)\b/iu;
/** The level writing a resume in a language shows of it: fluent, never native. */
const WRITTEN_LEVEL: AtsCefrLevel = "C1";
/** The sentence lines a resume needs to show the language it is written in. */
const MIN_WRITTEN_LINES = 3;

/** A language's English name from its ISO 639 code ("en" → "English"), where the runtime knows it. */
function englishName(id: string) {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(id);
  } catch {
    return undefined;
  }
}

/**
 * The languages, by English name, a resume is written in: of those it is read in
 * (`resumeLanguages`, else the policy's own), each its sentences (bullets, a summary) show: at
 * least `MIN_WRITTEN_LINES` of them, most holding the language's own detection words (or script),
 * whether or not the policy has a pack for the others; not merely one a host asked to read it in.
 * Never its headings, dates or names, which an engine writes in English for a structured document.
 */
export function writtenLanguages(
  policy: AtsEnginePolicy,
  resumeLanguages: readonly string[],
  text: string,
): string[] {
  const names = policy.keywordMatch.requirements.languageNames;
  const lines = text
    .split("\n", MAX_EVIDENCE_LINES)
    .map((line) => line.replace(BULLET_PREFIX, ""))
    .filter((line) => readsAsSentence(line) && !isDatedLine(line, policy));
  const sample = sampleOf(lines.join("\n"));
  return (resumeLanguages.length ? resumeLanguages : [policy.text.language]).flatMap((id) => {
    const pack = policy.locales.languages.find((candidate) => candidate.id === id);
    const detection = pack ?? (id === policy.text.language ? policy.text : undefined);
    // Each line judged by the language's own words, as one without any counts against it: one
    // English summary over Spanish bullets is no English resume, though the policy reads no Spanish.
    if (
      !detection ||
      lines.length < MIN_WRITTEN_LINES ||
      lines.filter((line) => showsAny(line, detection)).length * 2 <= lines.length ||
      !isWrittenIn(sample, detection)
    )
      return [];
    const name = (pack?.name ?? englishName(id))?.toLowerCase();
    const english = name && (own(names, name) ?? name);
    // A language the policy knows: English names map to themselves.
    return english && own(names, english) === english ? [english] : [];
  });
}

/** A resume section with the heading line that opened it, when one did: "Certifications". */
export type HeadedSection = ResumeSection & { heading?: string };

/**
 * Each section with the line that opened it (`segmentResume` keeps the heading's kind, not its
 * words). Recovered by walking the lines the sections were cut from; when they do not line up,
 * no heading is given.
 */
export function withHeadings(
  lines: readonly string[],
  sections: readonly ResumeSection[],
): HeadedSection[] {
  const headings: Array<string | undefined> = [];
  let at = 0;
  for (const section of sections) {
    let heading: string | undefined;
    let body = section.lines.length;
    if (section.headed) {
      heading = lines[at];
      at += 1;
      // A heading with text after it ("Certifications: BLS") opens its section with that text.
      if (body && section.lines[0] !== lines[at] && heading?.includes(section.lines[0]!)) body -= 1;
    }
    at += body;
    if (body && section.lines.at(-1) !== lines[at - 1]) return [...sections];
    headings.push(heading);
  }
  if (at !== lines.length) return [...sections];
  return sections.map((section, i) =>
    headings[i] === undefined ? section : { ...section, heading: headings[i] },
  );
}

type Status = "met" | "partial" | "missing";
const STRENGTH: Record<Status, number> = { missing: 0, partial: 1, met: 2 };
const weaker = (a: Status, b: Status) => (STRENGTH[a] <= STRENGTH[b] ? a : b);
const stronger = (a: Status, b: Status) => (STRENGTH[a] >= STRENGTH[b] ? a : b);

/** Where evidence is strongest: work history first, a bare skills list last. */
const EVIDENCE_RANK: Record<ResumeSectionKind, number> = {
  experience: 0,
  projects: 1,
  certifications: 2,
  languages: 2,
  other: 2,
  education: 3,
  skills: 4,
};

type Matchers = {
  years: RegExp[];
  /** Global. */
  languages: RegExp[];
  /** Every language the policy names: `languageNames` keys and values. */
  languageNames: Set<string>;
  /** Any of those names, as a word, globally: which languages a resume line names. */
  anyLanguage: RegExp;
  /** A line that opens with a language, after any "Label:": "Languages: German (native)". */
  leadingLanguage: RegExp;
  /** A line that states a nationality: "Nationality: German". Never proof of a language. */
  nationality: RegExp;
  equivalence: RegExp;
  /**
   * Global, with `relatedField`: cut out of the text between a degree and the years. The field
   * before one is the degree's, not the years'.
   */
  equivalences: RegExp;
  /** The words a posting offers alternatives with: "or", "oder". */
  alternation: RegExp;
  /** A clause the posting marks optional: "MBA a plus". */
  preferred: RegExp;
  /** The same, global: blanked out to see what else a clause says. */
  preferredAll: RegExp;
  authorization: RegExp;
  needsSponsorship: RegExp;
  noSponsorship: RegExp;
  sponsorshipOffered: RegExp;
  /** The same, global: blanked out to read what else a line says. */
  noSponsorshipAll: RegExp;
  negation: RegExp;
  /** The same, global: blanked out to see whether a clause says anything else. */
  negationAll: RegExp;
  notHeld: RegExp;
  notHeldNearby: RegExp;
  citizenship: RegExp;
  residence: RegExp;
  /**
   * The countries a right to work is stated for, each by name and a global pattern too, with
   * where its citizens work.
   */
  countries: Array<{
    name: string;
    pattern: RegExp;
    all: RegExp;
    citizensWorkIn: readonly string[];
  }>;
  /** Global: the words joining a list of places. */
  placeJoiners: RegExp;
  clearance: RegExp;
  /** The same, global: where in a line each clearance is named. */
  clearanceAll: RegExp;
  /** Clearance levels, highest first, each with its rank (0 the lowest) and a global pattern. */
  clearanceLevels: Array<{ name: string; rank: number; pattern: RegExp }>;
  /** Seniority levels, lowest first, each with the years it takes. */
  seniorityLevels: Array<{ rank: number; years: number; pattern: RegExp }>;
  /** `qualifiers`, each folded to the tokens a line is read as. */
  qualifiers: Array<{ tokens: Set<string>; sameLine: boolean }>;
};

const matchersOf = memo((km: AtsEnginePolicy["keywordMatch"]): Matchers => {
  const r = km.requirements;
  const names = [...new Set(Object.entries(r.languageNames).flat())].map(escapeRegex);
  const vocab = buildVocabulary(km);
  return {
    years: r.yearsPatterns.map((pattern) => policyRegex(pattern, "i")),
    languages: r.languagePatterns.map((pattern) => policyRegex(pattern, "gi")),
    languageNames: new Set(
      Object.entries(r.languageNames).flatMap((pair) => pair.map((name) => name.toLowerCase())),
    ),
    anyLanguage: wordListRegex(names, "gi"),
    // Anchored, label bounded: linear.
    leadingLanguage: new RegExp(
      `^\\s*(?:[^:]{1,40}:\\s*)?${wordListPattern(names)}\\s*(?:$|[(,;:/|–—-])`,
      "iu",
    ),
    nationality: new RegExp(`^\\s*${wordListPattern(km.nationalityLabels)}`, "iu"),
    equivalence: wordListRegex(r.equivalence),
    // Schema-defaulted; a hand-built policy may lack `relatedField`.
    equivalences: wordListRegex([...r.equivalence, ...(r.relatedField ?? [])], "gi"),
    alternation: wordListRegex(km.alternationWords),
    preferred: wordListRegex(km.preferredMarkers),
    preferredAll: wordListRegex(km.preferredMarkers, "gi"),
    authorization: wordListRegex(r.authorization),
    needsSponsorship: wordListRegex(r.needsSponsorship),
    noSponsorship: wordListRegex(r.noSponsorship),
    // Schema-defaulted; a hand-built policy may lack it.
    sponsorshipOffered: wordListRegex(r.sponsorshipOffered ?? ["(?!)"]),
    noSponsorshipAll: wordListRegex(r.noSponsorship, "gi"),
    negation: wordListRegex(r.negation),
    negationAll: wordListRegex(r.negation, "gi"),
    notHeld: wordListRegex(r.notHeld),
    // Schema-defaulted; a hand-built policy may lack these.
    notHeldNearby: wordListRegex(r.notHeldNearby ?? ["(?!)"]),
    citizenship: wordListRegex(r.citizenship),
    residence: wordListRegex(r.residence),
    countries: (r.countries ?? []).map(({ name, patterns, citizensWorkIn }) => ({
      name,
      pattern: wordListRegex(patterns),
      all: wordListRegex(patterns, "gi"),
      citizensWorkIn: citizensWorkIn ?? [],
    })),
    placeJoiners: wordListRegex(r.placeJoiners ?? ["(?!)"], "gi"),
    clearance: wordListRegex(r.clearance),
    clearanceAll: wordListRegex(r.clearance, "gi"),
    clearanceLevels: r.clearanceLevels
      .map(({ name, patterns }, rank) => ({ name, rank, pattern: wordListRegex(patterns, "gi") }))
      .reverse(),
    // Schema-defaulted; a hand-built policy may lack it.
    seniorityLevels: (r.seniorityLevels ?? []).map(({ years, patterns }, rank) => ({
      rank,
      years,
      pattern: wordListRegex(patterns),
    })),
    qualifiers: km.qualifiers.map(({ words, sameLine }) => ({
      tokens: new Set(
        words
          .map((word) => canonicalize(word, km, vocab))
          .filter((token): token is string => token !== null),
      ),
      sameLine,
    })),
  };
});

/** The languages a line asks for or states in a policy pattern: "fluent in German". */
function patternLanguages(text: string, matchers: Matchers) {
  return matchers.languages
    .flatMap((pattern) => [...text.matchAll(pattern)])
    .map((match) => match[1]?.toLowerCase())
    .filter(
      (captured): captured is string =>
        captured !== undefined && matchers.languageNames.has(captured),
    );
}

/** The highest seniority level a title names, and the word naming it; null when it names none. */
function seniorityOf(title: string, matchers: Matchers) {
  let found: { rank: number; years: number; word: string; index: number } | null = null;
  for (const { rank, years, pattern } of matchers.seniorityLevels) {
    const match = pattern.exec(title);
    if (match && (!found || rank > found.rank))
      found = { rank, years, word: match[0].toLowerCase(), index: match.index };
  }
  return found;
}

/** Words, and characters, past which a posting's first line is prose, not its title. */
const TITLE_WORDS = 8;
const TITLE_CHARS = 120;

const titleWordsIn = memo((rp: AtsEnginePolicy["resumeParse"]) =>
  wordListRegex(rp.titleWords, "gi"),
);

/**
 * The level a posting's title asks for ("Senior Backend Engineer"), judged by the resume's latest
 * title and its years: met by a title at or above it with half the years the level takes or more,
 * or by the years alone when the title names no level; partial with the title or the years
 * alone. Null when the posting's first line is no title, or names no level. A title names a job:
 * a title word besides its level word ("Lead Engineer", not the employer "Lead Bank"), unless the
 * level ends it ("Team Lead") or is an entry level, whose words are jobs ("Data Science Intern").
 * A line ending as a sentence ends, or a requirement ("senior stakeholders"), is not read.
 */
function seniorityRequirement(
  jobText: string,
  lines: readonly string[],
  parsed: AtsParsedResume,
  policy: AtsEnginePolicy,
  matchers: Matchers,
): AtsRequirement | null {
  const title = jobText.split("\n", 1)[0]!.trim();
  if (title.length > TITLE_CHARS || title.split(/\s+/).length > TITLE_WORDS) return null;
  if (/[.!?]$/u.test(title)) return null;
  const asked = seniorityOf(title, matchers);
  if (!asked) return null;
  // The title before a place, a note or a department: "Team Lead, Customer Support".
  const head = title
    .split(/\s[-–—|]\s|[,(]/u)[0]!
    .trim()
    .toLowerCase();
  const titleWords = [...title.matchAll(titleWordsIn(policy.resumeParse))];
  const namesJob =
    titleWords.some(({ index }) => index !== asked.index) ||
    (titleWords.length > 0 && (asked.rank === 0 || head.endsWith(asked.word)));
  if (!namesJob) return null;

  // The current role, else the one that ended last; of several, the highest level, then the
  // first listed.
  const when = (role: AtsParsedResume["roles"][number]) => {
    const date = role.end ?? role.start;
    return role.current ? Infinity : date ? date.year * 12 + (date.month ?? 12) : -Infinity;
  };
  const rank = (role: AtsParsedResume["roles"][number]) =>
    seniorityOf(role.title, matchers)?.rank ?? -1;
  const latest = parsed.roles.reduce<AtsParsedResume["roles"][number] | null>(
    (best, role) =>
      !best || when(role) > when(best) || (when(role) === when(best) && rank(role) > rank(best))
        ? role
        : best,
    null,
  );
  const held = latest?.title ? seniorityOf(latest.title, matchers) : null;
  const years = parsed.monthsOfExperience === null ? null : parsed.monthsOfExperience / 12;
  // An entry level takes no years, so a resume without dated roles meets it.
  const enough = asked.years === 0 || (years !== null && years >= asked.years);
  // A title alone, without half the years, may be a word misread or a title inflated.
  const titled = held !== null && held.rank >= asked.rank;
  const status = titled
    ? years === null || years >= asked.years / 2
      ? "met"
      : "partial"
    : enough
      ? held
        ? "partial"
        : "met"
      : "missing";
  // The role's own line: one naming its employer too, else its dated line, else the title alone.
  const line = latest?.title
    ? (lines.find(
        (l) => l.includes(latest.title) && latest.employer && l.includes(latest.employer),
      ) ??
      lines.find((l) => l.includes(latest.title) && isDatedLine(l, policy)) ??
      lines.find((l) => l.replace(BULLET_PREFIX, "").trim() === latest.title))
    : null;
  return {
    text: title,
    importance: "required",
    kind: "seniority",
    status,
    terms: [],
    evidence: line ? [line] : [],
    detail: [
      held ? `Latest title ${held.word}` : "No level in the latest title",
      years === null
        ? "no dated roles"
        : `${Math.floor(years)} year${Math.floor(years) === 1 ? "" : "s"} in the work history`,
    ]
      .join(", ")
      .concat(`; ${asked.word} asked${asked.years ? ` (${asked.years}+ years)` : ""}`),
  };
}

/**
 * The clearance levels a line names, by rank. Read from the highest down, a match within a higher
 * level's left out: "Top Secret" is not also "Secret"; "SC or DV clearance" names both.
 */
function clearanceRanks(text: string, matchers: Matchers) {
  const ranks: number[] = [];
  const taken = new Uint8Array(text.length);
  for (const { rank, pattern } of matchers.clearanceLevels)
    for (const { index, 0: found } of text.matchAll(pattern)) {
      if (taken.subarray(index, index + found.length).includes(1)) continue;
      taken.fill(1, index, index + found.length);
      if (!ranks.includes(rank)) ranks.push(rank);
    }
  return ranks;
}

/**
 * The levels a posting asks a clearance at: those within three words of a clearance ("Secret or
 * Top Secret clearance"), not further on ("Top Secret clearance required to handle confidential
 * information" asks for Top Secret). With none beside it, any the line names.
 */
function askedClearanceRanks(text: string, matchers: Matchers) {
  // A requirement is at most 300 characters, so cutting at each clearance is cheap.
  const near = [...text.matchAll(matchers.clearanceAll)].flatMap(({ index, 0: found }) => {
    const before = text.slice(0, index).split(/\s+/u);
    const after = text
      .slice(index + found.length)
      .split(/\s+/u)
      .slice(0, 4);
    const window = (from: number) =>
      clearanceRanks([...before.slice(from), found, ...after].join(" "), matchers);
    // Three words before it, and further back over a list of levels ("BPSS, CTC, SC or DV").
    let from = Math.max(0, before.length - 4);
    let ranks = window(from);
    while (from > 0) {
      const wider = window(from - 1);
      if (wider.length <= ranks.length) break;
      [from, ranks] = [from - 1, wider];
    }
    return ranks;
  });
  return near.length ? near : clearanceRanks(text, matchers);
}

/**
 * The clearances a resume line says are held, each as the text about it: from the clearance
 * named before it to the one named after. A not-held word anywhere in that text ("pending",
 * "expired"), a negated one in its own sentence, cut at a semicolon ("not active", `notHeldNearby`),
 * a negation in its own clause (cut at a comma or bracket too), or a negation alone in the clause
 * after it ("(no)", ": no") says it is not held: "Top Secret clearance (TS/SCI eligible)" holds Top
 * Secret, "Active TS/SCI clearance, no lapses since 2015" and "Active Secret clearance;
 * Relocation: No" hold theirs.
 */
function heldClearances(line: string, matchers: Matchers) {
  const named = [...line.matchAll(matchers.clearanceAll)];
  return named.flatMap((match, at) => {
    const before = named[at - 1];
    const from = before ? before.index + before[0].length : 0;
    const about = line.slice(from, named[at + 1]?.index ?? line.length);
    const where = match.index - from;
    const sentence = about.slice(about.lastIndexOf(";", where) + 1).split(";", 1)[0]!;
    const start = Math.max(...[";", ",", "(", ")"].map((mark) => about.lastIndexOf(mark, where)));
    const end = about.slice(where).search(/[;,()]/u);
    const clause = about.slice(start + 1, end < 0 ? about.length : where + end);
    // The clause next after its own, when a negation alone, answers for the clearance:
    // "TS/SCI clearance (no)", "Secret clearance, no"; not another label's "Relocation: No".
    const next = (end < 0 ? "" : about.slice(where + end))
      .split(/[;,():]/u)
      .find((part) => /\p{L}/u.test(part));
    const answersNo = next !== undefined && !/\p{L}/u.test(next.replace(matchers.negationAll, ""));
    return matchers.notHeld.test(about) ||
      matchers.notHeldNearby.test(sentence) ||
      matchers.negation.test(clause) ||
      answersNo
      ? []
      : [about];
  });
}

const placeNamesIn = memo((rp: AtsEnginePolicy["resumeParse"]) =>
  wordListRegex(rp.placeNames, "gi"),
);

/**
 * What of a text lists places: each character marked as in a country's name (`countries`),
 * another place's (`placeNames`) or a joiner (`placeJoiners`). `list` says whether a stretch names
 * a place and nothing else ("Canada and the UK"); `unknown`, whether it names a place no country
 * does ("Ontario"). Each pattern runs once over the text, so stretches are read in their length.
 */
function placeLists(text: string, matchers: Matchers, policy: AtsEnginePolicy) {
  const [COUNTRY, PLACE, OTHER, JOINER] = [1, 2, 4, 8];
  const marks = new Uint8Array(text.length);
  const mark = (from: number, to: number, flag: number) => {
    for (let i = from; i < to; i++) marks[i]! |= flag;
  };
  for (const { all } of matchers.countries)
    for (const { index, 0: found } of text.matchAll(all))
      mark(index, index + found.length, COUNTRY);
  for (const { index, 0: found } of text.matchAll(placeNamesIn(policy.resumeParse))) {
    const known = marks.subarray(index, index + found.length).some((flag) => flag & COUNTRY);
    mark(index, index + found.length, known ? PLACE : PLACE | OTHER);
  }
  for (const { index, 0: found } of text.matchAll(matchers.placeJoiners))
    mark(index, index + found.length, JOINER);
  return {
    list: (from: number, to: number) => {
      let place = false;
      for (let i = from; i < to; i++) {
        if (marks[i]! & (COUNTRY | PLACE)) place = true;
        else if (!marks[i] && /[\p{L}\p{N}]/u.test(text.charAt(i))) return false;
      }
      return place;
    },
    unknown: (from: number, to: number) => marks.subarray(from, to).some((flag) => flag & OTHER),
    /** Where the stretch of places and joiners ending at `to` starts: "US/" in "Dual US/". */
    from: (to: number) => {
      let i = to;
      while (i > 0 && (marks[i - 1] || !/[\p{L}\p{N}]/u.test(text.charAt(i - 1)))) i--;
      return i;
    },
  };
}

/**
 * The right to work: met by a statement of it, never by one that says the opposite. A line is
 * read without what says no sponsorship is needed ("not requiring sponsorship"); what is left
 * that needs sponsorship is no evidence, and evidence against where the posting rules sponsorship
 * out; what is left negated ("Cannot work in the US") is no evidence. An ask for citizenship
 * alone is met only by citizenship held; a line naming permanent residence instead says it is
 * not held. A line naming only other countries than the posting asks about says nothing of it.
 * Otherwise the question is the application's.
 */
function judgeAuthorization(
  ask: string,
  lines: ReadonlyArray<{ line: string }>,
  matchers: Matchers,
  policy: AtsEnginePolicy,
): { status: Status | "unverifiable"; lines: Array<{ line: string }> } {
  const countriesIn = (text: string) =>
    matchers.countries.filter(({ pattern }) => pattern.test(text));
  // Where a statement gives the right to work: the countries it names, and where the citizens of
  // those may work too when it states a citizenship ("Irish citizen": Ireland, the UK, the EU).
  const rightsIn = (text: string) => {
    const named = countriesIn(text);
    const also = matchers.citizenship.test(text) ? named.flatMap((c) => c.citizensWorkIn) : [];
    return [...named.map(({ name }) => name), ...also];
  };
  const asked = countriesIn(ask).map(({ name }) => name);
  const about = (names: readonly string[]) =>
    !asked.length || !names.length || names.some((name) => asked.includes(name));
  // Whose citizenship a clause states: the countries its citizenships name, and those listed just
  // before one ("Dual US/Canadian citizen"); not after ("Canadian citizen living in the US"), nor
  // further before ("Authorized to work in the US. Also hold an EU passport").
  const citizenshipAll = new RegExp(matchers.citizenship.source, "giu");
  const citizenOf = (clause: string) => {
    const { from } = placeLists(clause, matchers, policy);
    return [...clause.matchAll(citizenshipAll)].flatMap(({ index, 0: found }) =>
      countriesIn(clause.slice(from(index), index + found.length)).map(({ name }) => name),
    );
  };
  const phrases = new RegExp(matchers.authorization.source, "giu");
  const statedAll = [phrases, citizenshipAll, new RegExp(matchers.residence.source, "giu")];
  const states = (clause: string) =>
    matchers.authorization.test(clause) ||
    matchers.citizenship.test(clause) ||
    matchers.residence.test(clause);
  const stated = lines.flatMap((entry) => {
    const { line } = entry;
    if (!states(line)) return [];
    // A heading or label alone ("Work Authorization") states nothing; "U.S. citizen" does.
    if (
      !matchers.citizenship.test(line) &&
      !matchers.residence.test(line) &&
      !/[\p{L}\p{N}]/u.test(line.replace(phrases, ""))
    )
      return [];
    const rest = line.replace(matchers.noSponsorshipAll, " ");
    // Clause by clause, so a negation about something else ("(no visa needed)", "not open to
    // relocation") does not negate the statement. Each clause with where it starts and whether
    // it is in brackets.
    const parts: Array<{ text: string; start: number; bracketed: boolean }> = [];
    let depth = 0;
    let offset = 0;
    rest.split(/([;,()])/u).forEach((piece, at) => {
      if (at % 2 === 0) parts.push({ text: piece, start: offset, bracketed: depth > 0 });
      else depth = piece === "(" ? depth + 1 : piece === ")" ? Math.max(0, depth - 1) : depth;
      offset += piece.length;
    });
    const { list, unknown } = placeLists(rest, matchers, policy);
    // Each stating clause, with the clauses after it that list only places when it ends in one
    // ("Authorized to work in the US, Canada and the UK"), passing over brackets ("Canada (PR)
    // and the U.S. (TN visa)"). A place the countries do not name ("Ontario") leaves the line
    // read as it stands.
    let unknownPlace = false;
    const clauses: string[] = [];
    parts.forEach(({ text, start }, at) => {
      if (!states(text)) return;
      const end = Math.max(
        0,
        ...statedAll.flatMap((pattern) =>
          [...text.matchAll(pattern)].map((found) => found.index + found[0].length),
        ),
      );
      const tail = list(start + end, start + text.length);
      let said = text;
      if (tail) {
        unknownPlace ||= unknown(start + end, start + text.length);
        for (let next = at + 1; next < parts.length; next++) {
          const part = parts[next]!;
          if (states(part.text)) break;
          if (part.bracketed || !/[\p{L}\p{N}]/u.test(part.text)) continue;
          if (!list(part.start, part.start + part.text.length)) break;
          unknownPlace ||= unknown(part.start, part.start + part.text.length);
          said += `, ${part.text}`;
        }
      }
      clauses.push(said);
    });
    const named = unknownPlace ? [] : rightsIn(line);
    if (!about(named)) return [];
    if (matchers.needsSponsorship.test(rest)) return [{ entry, says: [line], needs: true }];
    // A clause saying where it does not hold takes it back: "Authorized to work in Canada, not in
    // the US".
    if (
      parts.some(
        ({ text }) => !states(text) && matchers.negation.test(text) && namesPlace(text, policy),
      )
    )
      return [];
    // A clause naming only other countries says nothing of the one asked about ("Indian citizen;
    // authorized to work in the US" holds no US citizenship); one naming none, what the line names.
    const held = (clauses.length ? clauses : [rest]).filter((clause) => {
      const where = unknownPlace ? [] : rightsIn(clause);
      return !matchers.negation.test(clause) && about(where.length ? where : named);
    });
    return held.length ? [{ entry, says: held, needs: false }] : [];
  });
  const shown = stated.filter(({ needs }) => !needs);
  const needing = stated.filter(({ needs }) => needs).map(({ entry }) => entry);
  if (matchers.citizenship.test(ask) && !matchers.residence.test(ask)) {
    // A citizenship meets only an ask for its own country: an Irish citizen may work in the UK,
    // but is no British citizen.
    const citizen = shown.filter(({ says }) => {
      const all = says.join(";");
      return (
        matchers.citizenship.test(all) &&
        !matchers.residence.test(all) &&
        !matchers.notHeld.test(all) &&
        says.some((clause) => {
          const of = citizenOf(clause);
          return of.length > 0 && (!asked.length || of.some((name) => asked.includes(name)));
        })
      );
    });
    if (citizen.length) return { status: "met", lines: citizen.map(({ entry }) => entry) };
    const against = [
      ...shown
        .filter(({ says }) => matchers.residence.test(says.join(";")))
        .map(({ entry }) => entry),
      ...needing,
    ];
    return { status: against.length ? "missing" : "unverifiable", lines: against };
  }
  // A posting excludes by ruling sponsorship out ("without sponsorship"), or by turning away who
  // needs it with a negation or without offering it in that clause; "We welcome applicants who
  // require sponsorship" does not.
  const offered = ask
    .split(/[.;:,()]/u)
    .some(
      (clause) =>
        matchers.needsSponsorship.test(clause) && matchers.sponsorshipOffered.test(clause),
    );
  const excludes =
    matchers.noSponsorship.test(ask) ||
    (matchers.needsSponsorship.test(ask) && (matchers.negation.test(ask) || !offered));
  if (excludes && needing.length) return { status: "missing", lines: needing };
  return {
    status: shown.length ? "met" : "unverifiable",
    lines: shown.map(({ entry }) => entry),
  };
}

/** The word after a position, when only spaces stand before it. */
const NEXT_WORD = /\s*(\p{L}[\p{L}\p{M}'’-]*)/uy;

/**
 * Every language a requirement asks for: in a policy pattern ("fluent in German"), or named on
 * its own, at the end, before punctuation ("English/Spanish") or before a function word. A name
 * before a plain word describes it ("German enterprise customers"). `alone` reads the second
 * kind without the first; a line about years or a degree is never only a language.
 */
function askedLanguages(
  ask: string,
  matchers: Matchers,
  km: AtsEnginePolicy["keywordMatch"],
  vocab: ReturnType<typeof buildVocabulary>,
  alone: boolean,
) {
  const shaped = patternLanguages(ask, matchers);
  if (!shaped.length && !alone) return [];
  const next = new RegExp(NEXT_WORD.source, "uy");
  const standalone = [...ask.matchAll(matchers.anyLanguage)]
    .filter((match) => {
      next.lastIndex = match.index + match[0].length;
      const word = next.exec(ask)?.[1];
      return word === undefined || canonicalize(word, km, vocab) === null;
    })
    .map((match) => match[0].toLowerCase());
  // Each language once, by whichever name: "Englischkenntnisse" is read as a whole and in part.
  const seen = new Set<string>();
  return [...shaped, ...standalone].filter((name) => {
    const english = own(km.requirements.languageNames, name) ?? name;
    if (seen.has(english)) return false;
    seen.add(english);
    return true;
  });
}

/**
 * Whether a resume line lists languages rather than naming one in passing ("launched in the
 * Chinese market"): it opens with one ("German (native)"), names two or more, or states one the
 * way a posting asks ("native German speaker"). "Nationality: German" lists none.
 */
function listsLanguages(line: string, matchers: Matchers, names: Record<string, string>) {
  const body = line.replace(BULLET_PREFIX, "");
  if (matchers.nationality.test(body)) return false;
  if (matchers.leadingLanguage.test(body)) return true;
  const named = new Set(
    [...body.matchAll(matchers.anyLanguage)].map((match) => {
      const name = match[0].toLowerCase();
      return own(names, name) ?? name;
    }),
  );
  return named.size >= 2 || patternLanguages(body, matchers).length > 0;
}

/**
 * Whether the rows of a "Languages" heading list a spoken language: an item that is no skill
 * (`isSkillItem`). "Python, Go" or "C++, TypeScript" lists programming languages; "Klingon
 * (fluent)" is a language the policy does not know.
 */
function listsSpoken(lines: readonly string[], km: AtsEnginePolicy["keywordMatch"]) {
  return lines.some((line) =>
    line
      .replace(BULLET_PREFIX, "")
      .replace(/\([^()]*\)|\[[^[\]]*\]/gu, " ")
      .split(/[,;|/•·]/u)
      .some((item) => !isSkillItem(item, km)),
  );
}

/** Where one clause of a requirement ends: a comma, a semicolon, or the policy's "and" words. */
const clauseBreak = memo(
  (rp: AtsEnginePolicy["resumeParse"]) =>
    new RegExp(`[,;]|${wordListPattern(rp.headingConnectors)}`, "iu"),
);

/**
 * The CEFR level asked of each language: the level its own clause states ("Fluent English, basic
 * Spanish"), else the one level the whole ask states, else none. Level words are the resume's
 * (`languageLevels`), so "fluent" asks for C1.
 */
function askedLevels(ask: string, languages: readonly string[], policy: AtsEnginePolicy) {
  const clauses = ask.split(clauseBreak(policy.resumeParse)).map((clause) => ({
    text: clause.toLowerCase(),
    level: cefrLevel(clause, policy),
  }));
  const stated = new Set(clauses.flatMap(({ level }) => (level ? [level] : [])));
  const whole = stated.size === 1 ? [...stated][0]! : null;
  return new Map(
    languages.map((name) => [
      name,
      clauses.find(({ text, level }) => level && text.includes(name))?.level ?? whole,
    ]),
  );
}

/** A row below the level asked still counts for something from B1 up, or one step short. */
function belowLevel(have: AtsCefrLevel, asked: AtsCefrLevel): Status {
  return compareCefr(have, "B1") >= 0 || compareCefr(have, asked) === -1 ? "partial" : "missing";
}

/** Whether an alternation word joins two asks; the degree's own "or related field" does not. */
const offersAlternatives = (between: string, matchers: Matchers) =>
  matchers.alternation.test(between.replace(matchers.equivalences, " "));

/**
 * The requirement without the clauses it marks optional ("Bachelor's degree required; MBA a
 * plus" asks for the Bachelor's), blanked rather than cut so offsets line up. A line optional
 * throughout ("Python preferred") is kept whole and read as preferred.
 *
 * A marker covers its whole sentence part (up to a ";") when it opens it on its own ("Ideally,
 * you have 3+ years of Rust"), closes it on its own ("Kafka, ideally"), or closes a list it
 * continues with an alternation word ("Rust, Scala or Elixir is a plus"). Otherwise it covers
 * its own clause: "BS in Computer Science, MS preferred" still asks for the BS.
 */
function withoutOptional(text: string, matchers: Matchers) {
  const isClause = (clause: string) => /\p{L}/u.test(clause);
  const markerOnly = (clause: string) => !/\p{L}/u.test(clause.replace(matchers.preferredAll, " "));
  const blanked: string[] = [];
  let any = false;
  let all = true;
  for (const part of text.split(/(;)/)) {
    const clauses = (part.match(/[^,()]+/g) ?? []).filter(isClause);
    const optional = clauses.filter((clause) => matchers.preferred.test(clause));
    const first = clauses[0];
    const last = clauses.at(-1);
    const whole =
      clauses.length > 0 &&
      (optional.length === clauses.length ||
        (first !== undefined && matchers.preferred.test(first) && markerOnly(first)) ||
        (last !== undefined &&
          matchers.preferred.test(last) &&
          (markerOnly(last) || matchers.alternation.test(last))));
    if (whole) {
      any = true;
      blanked.push(" ".repeat(part.length));
      continue;
    }
    if (clauses.length) all = false;
    any ||= optional.length > 0;
    blanked.push(
      optional.reduce((out, clause) => out.replace(clause, " ".repeat(clause.length)), part),
    );
  }
  if (!any) return { asked: text, optional: false };
  if (all) return { asked: text, optional: true };
  return { asked: blanked.join(""), optional: false };
}

/**
 * The posting's requirement statements: each line, or sentence of a long one, under its headings.
 */
export function requirementLines(jobText: string, policy: AtsEnginePolicy) {
  const sections = segmentJob(jobText, policy);
  const hasRequired = sections.some((s) => s.kind === "required");
  // Without a Requirements heading (or with it unrecognised) the body's bullets are the
  // required items.
  const source = sections.flatMap((s) =>
    s.kind === "required" || s.kind === "preferred"
      ? [s]
      : s.kind === "body" && !hasRequired
        ? [
            {
              kind: "required" as const,
              text: s.text
                .split("\n")
                .filter((line) => BULLET_PREFIX.test(line))
                .join("\n"),
            },
          ]
        : [],
  );

  return source
    .flatMap((section) =>
      section.text
        .split("\n")
        .flatMap((line) =>
          line.length > MAX_REQUIREMENT_CHARS ? line.split(/(?<=[.;])\s+/) : [line],
        )
        .map((line) => line.replace(BULLET_PREFIX, "").trim())
        .filter((line) => /\p{L}/u.test(line) && !isOfferLine(line, policy))
        .map((line) => ({
          text: line.slice(0, MAX_REQUIREMENT_CHARS),
          importance: section.kind === "preferred" ? ("preferred" as const) : ("required" as const),
        })),
    )
    .slice(0, MAX_REQUIREMENTS);
}

const titleWordOf = memo(
  (rp: AtsEnginePolicy["resumeParse"]) => new RegExp(`^${wordListPattern(rp.titleWords)}$`, "iu"),
);

/**
 * The job-title nouns of a requirement, as tokens: a title word ("manager", "lead") straight
 * after a non-stopword ("Engineering Manager", "Tech Lead"), not an activity ("ability to lead").
 */
function titleNouns(
  text: string,
  policy: AtsEnginePolicy,
  vocab: ReturnType<typeof buildVocabulary>,
) {
  const km = policy.keywordMatch;
  const isTitle = titleWordOf(policy.resumeParse);
  const nouns = new Set<string>();
  let before: RegExpExecArray | null = null;
  for (const word of text.matchAll(/\p{L}[\p{L}\p{M}\p{N}'’]*/gu)) {
    const gap = before ? text.slice(before.index + before[0].length, word.index) : "";
    if (before && /^[\s-]+$/u.test(gap) && isTitle.test(word[0])) {
      const token = canonicalize(word[0], km, vocab);
      if (token && canonicalize(before[0], km, vocab) !== null) nouns.add(token);
    }
    before = word;
  }
  return nouns;
}

/** The years a pattern captured: a figure, or a number word ("five") the policy knows. */
function yearsAsked(captured: string | undefined, km: AtsEnginePolicy["keywordMatch"]) {
  const value = Number(captured);
  if (Number.isFinite(value)) return value;
  return own(km.numberWords, (captured ?? "").toLowerCase()) ?? null;
}

export function judgeRequirements(
  jobDescription: string | undefined,
  sections: readonly ResumeSection[],
  parsed: AtsParsedResume,
  policy: AtsEnginePolicy,
  now: Date,
  /** The languages, by English name, the resume is written in (`writtenLanguages`). */
  writtenIn: readonly string[] = [],
): AtsRequirement[] {
  const jobText = typeof jobDescription === "string" ? jobDescription.trim() : "";
  if (!jobText) return [];

  const km = policy.keywordMatch;
  const vocab = buildVocabulary(km);
  const matchers = matchersOf(km);
  const proper = properNounTokens(jobText, km.nounsCapitalized);

  // A credential heading ("Licenses and Certifications") certifies what is listed under it:
  // recognised, it opened the section; unrecognised, it is a line naming only credentials.
  const credentialTokens = new Set(
    matchers.qualifiers.filter((q) => q.sameLine).flatMap((q) => [...q.tokens]),
  );
  const credentialsIn = (text: string) => {
    const tokens = [...extractVocabulary(text, km, vocab).keys()];
    return tokens.length && tokens.every((token) => credentialTokens.has(token))
      ? new Set(tokens)
      : null;
  };
  const NONE = new Set<string>();

  // The resume line by line, each with its section and what it demonstrates. Only phrases the
  // resume contains are searched for per line, and lines are capped.
  const ranked = sections
    .flatMap((section) => {
      const heading = (section as HeadedSection).heading;
      // Every line of a certifications section is a credential.
      let context =
        section.kind === "certifications"
          ? credentialTokens
          : heading && (section.kind === "other" || section.kind === "languages")
            ? new Set(
                [...extractVocabulary(heading, km, vocab).keys()].filter((t) =>
                  credentialTokens.has(t),
                ),
              )
            : NONE;
      return section.lines.map((line) => {
        const opens =
          !BULLET.test(line) && line.split(/\s+/).length <= 5 && !/\d/u.test(line)
            ? credentialsIn(line)
            : null;
        if (opens) context = opens;
        return { line, kind: section.kind, context };
      });
    })
    .slice(0, MAX_EVIDENCE_LINES);
  const whole = ranked
    .map((entry) => entry.line)
    .join("\n")
    .toLowerCase();
  const present = { ...km, phrases: km.phrases.filter((phrase) => whole.includes(phrase)) };
  const resumeLines = ranked.map(({ line, kind, context }) => ({
    line,
    kind,
    rank: EVIDENCE_RANK[kind],
    context,
    holds: resumeCapabilities(extractVocabulary(line, present, vocab), vocab),
  }));
  const held = new Set(resumeLines.flatMap((entry) => [...entry.holds]));
  const evidenceFor = (test: (entry: (typeof resumeLines)[number]) => boolean) =>
    resumeLines
      .filter(test)
      .sort((a, b) => a.rank - b.rank)
      .slice(0, MAX_EVIDENCE)
      .map((entry) => entry.line.replace(BULLET_PREFIX, "").trim().slice(0, 160));
  let lists: boolean | undefined;
  const listsAny = () =>
    (lists ??=
      parsed.spokenLanguages.length > 0 ||
      resumeLines.some((entry) =>
        listsLanguages(entry.line, matchers, km.requirements.languageNames),
      ));
  // A "Languages" heading over programming languages or other skills lists no spoken language.
  let spokenList: boolean | undefined;
  const listsSpokenAny = () =>
    (spokenList ??= sections.some(
      (section) => section.kind === "languages" && listsSpoken(section.lines, km),
    ));
  // The certification rows, each with what it names: a credential asked for is met by one held.
  // Expired, dated after today or in progress (`inProgress`), a row is not held, and says why.
  // Schema-defaulted; a hand-built policy may lack it.
  const inProgressAll = wordListRegex(km.requirements.inProgress ?? ["(?!)"], "gi");
  // An in-progress word says the row is unfinished where it ends its clause ("CISSP (in
  // progress)", "CISSP – in progress", "Currently pursuing: CISSP") or opens the name after any
  // label ("Pursuing CISSP"). Followed by more words, it is about them ("Pursuing excellence:
  // CISSP", "Azure Fundamentals - working towards AZ-104"); in brackets in the issuer, about the
  // next item of a one-line list ("PMP (2019), Six Sigma Green Belt (in progress)"). After a
  // credential word in its clause, it is a renewal under way ("PMP (PMI; renewal in progress)").
  const { expires, issued } = policy.resumeParse.credentialWords;
  const renewing = wordListRegex([...expires, ...issued]);
  const unfinishedIn = (text: string, opening: boolean) => {
    const colon = opening ? text.lastIndexOf(":") : text.length;
    return [...text.matchAll(inProgressAll)].some((found) => {
      const before = text.slice(0, found.index);
      const clauseStart = Math.max(...[...":,;()[]|"].map((mark) => before.lastIndexOf(mark)));
      if (renewing.test(before.slice(clauseStart + 1))) return false;
      const after = text.slice(found.index + found[0].length);
      const clauseEnd = after.search(/[:,;()[\]|]|\s[–—-]\s/u);
      return (
        !/\p{L}/u.test(clauseEnd < 0 ? after : after.slice(0, clauseEnd)) ||
        (found.index > colon && !/\p{L}/u.test(text.slice(colon + 1, found.index)))
      );
    });
  };
  const BRACKETED = /\([^()]*\)|\[[^[\]]*\]/gu;
  const today = now.getUTCFullYear() * 12 + now.getUTCMonth() + 1;
  const monthOf = (date: { year: number; month: number | null }, edge: "start" | "end") =>
    date.year * 12 + (date.month ?? (edge === "start" ? 1 : 12));
  const holdsOf = (text: string) => resumeCapabilities(extractVocabulary(text, km, vocab), vocab);
  const certificationRows = parsed.certifications.flatMap((row) => {
    const line = formatCertification(row);
    // Bounded: a structured row's fields may be long.
    const name = row.name.slice(0, 300);
    const expired = row.expires && statesExpiry(row) && monthOf(row.expires, "end") < today;
    const dated = expired || (row.date && monthOf(row.date, "start") > today);
    const bracketed = !dated && unfinishedIn(name, true);
    const lapsed = expired
      ? `${row.name}: expired ${row.expires!.year}`
      : dated || bracketed || unfinishedIn(row.issuer.slice(0, 300).replace(BRACKETED, " "), false)
        ? `${row.name}: not yet held`
        : null;
    // Unfinished by a word in the name's own brackets, the row is an item of a one-line list and
    // its issuer the next item ("Six Sigma Green Belt (in progress), PMP, 2019"): what only the
    // issuer names is held. A date stays the whole row's.
    if (bracketed && !unfinishedIn(name.replace(BRACKETED, " "), true)) {
      const holds = holdsOf(row.name);
      const others = [...holdsOf(row.issuer)].filter((token) => !holds.has(token));
      return [
        { line, holds, lapsed },
        ...(others.length ? [{ line, holds: new Set(others), lapsed: null }] : []),
      ];
    }
    return [{ line, holds: holdsOf(`${row.name} ${row.issuer}`), lapsed }];
  });
  // What only lapsed rows show is not held, whatever the ask's words ("Active CISSP", "CISSP
  // required"): a skill a lapsed row names counts only from a line that is not a row, outside the
  // certifications and a "Certifications:" line ("Ran services on AWS" beside "AWS Certified
  // Developer (in progress)", "Ran Kubernetes clusters" beside an expired "Kubernetes" row).
  const lapsedTokens = new Set<string>();
  if (certificationRows.some((row) => row.lapsed)) {
    const heldRows = new Set(
      certificationRows.flatMap((row) => (row.lapsed ? [] : [...row.holds])),
    );
    const shownElsewhere = new Set(
      resumeLines.flatMap((entry) =>
        entry.kind === "certifications" ||
        (entry.kind === "skills" &&
          labelledLine(entry.line.replace(BULLET_PREFIX, ""), policy)?.kind === "certifications")
          ? []
          : [...entry.holds],
      ),
    );
    for (const row of certificationRows)
      if (row.lapsed)
        for (const token of row.holds)
          if (!heldRows.has(token) && !shownElsewhere.has(token)) {
            lapsedTokens.add(token);
            held.delete(token);
          }
  }

  // What each dated role's lines hold. A role is anchored on its dated line and the header lines
  // just above it naming its title or employer, never on a bullet that names an employer.
  let roleHolds: Array<Set<string>> | undefined;
  const holdingsOfRoles = () => {
    if (roleHolds) return roleHolds;
    const work = resumeLines.filter((entry) => entry.kind === "experience");
    const holds = parsed.roles.map(() => new Set<string>());
    const names = (at: number, role: number) => {
      const { title, employer } = parsed.roles[role]!;
      const line = work[at]!.line;
      return (
        !BULLET.test(line) &&
        Boolean((title && line.includes(title)) || (employer && line.includes(employer)))
      );
    };
    // Only the lines the parser reads as roles: a leave or a dated sentence is none.
    const dated = work.flatMap((entry, at) => (roleDates(entry.line, policy, now) ? [at] : []));
    const owner = new Array<number>(work.length).fill(-1);
    if (dated.length === parsed.roles.length) {
      // Each dated line in order, raised to the header lines above it that name the role.
      const starts = dated.map((at, role) => {
        const floor = Math.max(role ? dated[role - 1]! + 1 : 0, at - 3);
        let start = at;
        for (let up = at - 1; up >= floor && !BULLET.test(work[up]!.line); up -= 1)
          if (names(up, role)) start = up;
        return start;
      });
      starts.forEach((start, role) => {
        const end = starts[role + 1] ?? work.length;
        for (let at = start; at < end; at += 1) owner[at] = role;
      });
    } else {
      // Roles the lines do not show (structured document, hidden line): follow their headers.
      let role = -1;
      work.forEach((_, at) => {
        const next = parsed.roles.findIndex((__, index) => index > role && names(at, index));
        if (next >= 0) role = next;
        owner[at] = role;
      });
    }
    work.forEach((entry, at) => {
      const role = owner[at]!;
      if (role >= 0) for (const token of entry.holds) holds[role]!.add(token);
    });
    return (roleHolds = holds);
  };
  /**
   * The roles naming what a years ask is of: any of its skills, or for a field in plain words
   * ("software engineering") every word of it; each group by any of its members.
   */
  const rolesWith = (groups: ReadonlyArray<readonly string[]>, every: boolean) =>
    holdingsOfRoles().flatMap((holds, index) => {
      const has = (group: readonly string[]) => group.some((token) => holds.has(token));
      return (every ? groups.every(has) : groups.some(has)) ? [parsed.roles[index]!] : [];
    });
  // The highest level a resume line names, or -1.
  const lineLevel = (line: string) => degreeLevels(line, policy)[0]?.isced ?? -1;

  const lines = requirementLines(jobText, policy).flatMap((line) => {
    const years = matchers.years.map((re) => re.exec(line.text)).find(Boolean) ?? null;
    if (!years || (!matchers.authorization.test(line.text) && !matchers.clearance.test(line.text)))
      return [line];
    return [
      { ...line, text: line.text.slice(0, years.index).trim() },
      { ...line, text: line.text.slice(years.index).trim() },
    ].filter((part) => part.text.length > 0);
  });

  // The clearance levels each resume line holds, read once.
  const heldOn = new WeakMap<object, number[] | null>();
  const heldLevels = (entry: { line: string }) => {
    if (!heldOn.has(entry)) {
      const held = heldClearances(entry.line, matchers);
      heldOn.set(
        entry,
        held.length ? held.flatMap((about) => clearanceRanks(about, matchers)) : null,
      );
    }
    return heldOn.get(entry)!;
  };

  const judged = lines.map(({ text, importance: heading }) => {
    const { asked: ask, optional } = withoutOptional(text, matchers);
    const importance = optional ? ("preferred" as const) : heading;
    const base = { text, importance };

    // Right to work and clearance: settled in the application, unless the resume says.
    if (matchers.authorization.test(text)) {
      const { status, lines: shown } = judgeAuthorization(ask, resumeLines, matchers, policy);
      const lines = new Set(shown);
      return {
        ...base,
        kind: "authorization",
        status,
        terms: [],
        evidence: evidenceFor((entry) => lines.has(entry)),
      } satisfies AtsRequirement;
    }
    if (matchers.clearance.test(text)) {
      const holds = (entry: { line: string }) => heldLevels(entry) !== null;
      const evidence = evidenceFor(holds);
      // A level asked is met by it or one above; the lowest the ask names is the bar.
      const asked = Math.min(...askedClearanceRanks(ask, matchers));
      const held = Math.max(-1, ...resumeLines.flatMap((entry) => heldLevels(entry) ?? []));
      const levels = km.requirements.clearanceLevels;
      const short = evidence.length > 0 && Number.isFinite(asked) && held < asked;
      return {
        ...base,
        kind: "clearance",
        status: !evidence.length ? "unverifiable" : short ? "partial" : "met",
        terms: [],
        evidence,
        ...(short
          ? {
              detail: `${held < 0 ? "No level" : levels[held]!.name} read, ${levels[asked]!.name} asked`,
            }
          : {}),
      } satisfies AtsRequirement;
    }

    const years = matchers.years.map((re) => re.exec(ask)).find(Boolean) ?? null;
    // Every level the line names, highest first; not a state code after a city ("Boston MA").
    const levels = degreeLevels(withoutIgnored(ask, policy), policy);

    // A language is met when the resume names it by any name the packs know; only a policy-listed
    // name is one ("proficient in Python" has the shape of "fluent in German"). Every language
    // named is asked for: "Bilingual English/Spanish" is not met by English alone.
    const languages = askedLanguages(ask, matchers, km, vocab, !(years || levels.length));
    if (languages.length) {
      const names = km.requirements.languageNames;
      const asked = askedLevels(ask, languages, policy);
      const states = languages.map((name) => {
        const english = own(names, name) ?? name;
        const aliases = [
          english,
          ...Object.keys(names).filter((alias) => names[alias] === english),
        ];
        const named = wordListRegex([...new Set([name, ...aliases])].map(escapeRegex));
        const shows = (entry: (typeof resumeLines)[number]) =>
          named.test(entry.line) &&
          !WEAK_LANGUAGE.test(entry.line) &&
          !matchers.nationality.test(entry.line.replace(BULLET_PREFIX, ""));
        // A spoken-language row decides, at the level asked; without one, a line naming it does;
        // failing both, the language the resume's sentences are written in, at `WRITTEN_LEVEL`:
        // only when no line names the language ("English: basic") and the resume lists no
        // spoken languages, which would have named it; a list of skills ("Languages: Python, Go")
        // under any heading lists none.
        const row = parsed.spokenLanguages.find(
          (spoken) => canonicalLanguage(spoken.language, policy) === english,
        );
        const shown = !row && resumeLines.some(shows);
        const written =
          !row &&
          writtenIn.includes(english) &&
          !listsAny() &&
          !listsSpokenAny() &&
          !resumeLines.some((entry) => named.test(entry.line));
        const have = row?.cefr ?? (written ? WRITTEN_LEVEL : null);
        const level = asked.get(name) ?? null;
        const short = have && level && compareCefr(have, level) < 0;
        const status: Status | null =
          row || written ? (short ? belowLevel(have!, level!) : "met") : shown ? "met" : null;
        // A compound by the language it names: "Englischkenntnisse" as "Englisch".
        const plainOf = (word: string) =>
          word.slice(0, aliases.find((alias) => word.toLowerCase().startsWith(alias))?.length);
        const plain = plainOf(name);
        const label = row
          ? plainOf(row.language)
          : `${plain.charAt(0).toUpperCase()}${plain.slice(1)}`;
        const by = written ? " from the language the resume is written in" : "";
        return {
          plain,
          shows,
          row,
          status,
          detail: short
            ? `${label}: ${have} read${by}, ${level} asked`
            : written
              ? `${label}: the resume is written in it`
              : null,
        };
      });
      const met = states.filter((state) => state.status === "met").length;
      const some = states.some((state) => state.status === "met" || state.status === "partial");
      const fromRows = states.flatMap((state) =>
        state.row && state.status !== "missing" ? [formatSpokenLanguage(state.row)] : [],
      );
      const fromLines = evidenceFor((entry) =>
        states.some((state) => !state.row && state.shows(entry)),
      );
      const detail = states.flatMap((state) => (state.detail ? [state.detail] : [])).join("; ");
      return {
        ...base,
        kind: "language",
        // Unnamed is not absent: a resume rarely says "English". One that lists languages and
        // leaves one off is missing it; one that lists none leaves it to the application.
        status:
          met === states.length
            ? "met"
            : some
              ? "partial"
              : listsAny()
                ? "missing"
                : "unverifiable",
        terms: states.map(({ plain, status }) => ({
          term: plain,
          found: status === "met" || status === "partial",
        })),
        evidence: [...new Set([...fromRows, ...fromLines])].slice(0, MAX_EVIDENCE),
        ...(detail ? { detail } : {}),
      } satisfies AtsRequirement;
    }

    const placed = levels
      .map(({ matched }) => ({ start: ask.indexOf(matched), length: matched.length }))
      .filter(({ start }) => start >= 0)
      .map(({ start, length }) => ({ start, end: start + length }))
      .sort((a, b) => a.start - b.start);
    // As alternatives ("Bachelor's or Master's", "BS/MS") the lowest level is the bar; asked
    // together ("a Master's and a teaching certificate") the highest.
    const alternatives = placed.slice(1).some((at, i) => {
      const between = ask.slice(placed[i]!.end, at.start);
      return between.includes("/") || matchers.alternation.test(between);
    });
    const degree = (alternatives ? levels.at(-1) : levels[0]) ?? null;
    // "A Bachelor's degree or 4+ years": either meets the line, when an alternation word stands
    // between the years and the nearest degree, in the years' own clause.
    const eitherAsk = (() => {
      if (!years) return false;
      const from = years.index;
      const to = from + years[0].length;
      const clauses = clauseBreak(policy.resumeParse);
      const nearest = placed
        .map(({ start, end }) =>
          end <= from
            ? ask.slice(end, from).split(clauses).at(-1)!
            : start >= to
              ? ask.slice(to, start).split(clauses)[0]!
              : null,
        )
        .filter((between): between is string => between !== null)
        .sort((a, b) => a.length - b.length)[0];
      return nearest !== undefined && offersAlternatives(nearest, matchers);
    })();

    // What the requirement names beyond years and degree: named skills if any, else plainer words.
    const rest = [years?.[0], ...levels.map((level) => level.matched)].reduce<string>(
      (out, matched) => (matched ? out.replace(matched, " ") : out),
      ask,
    );
    // "Go or Java" is one ask, met by any member.
    const { find } = alternationGroups([rest], km, vocab);
    const extracted = [...extractVocabulary(rest, km, vocab)];
    // A title noun is the title, not the activity ("Manager" in "Engineering Manager").
    const titles = titleNouns(rest, policy, vocab);
    const isQualifier = (token: string) =>
      !titles.has(token) && matchers.qualifiers.some((qualifier) => qualifier.tokens.has(token));
    // An activity or credential is part of the ask ("mentoring engineers", "AWS certification").
    const qualifiers = matchers.qualifiers.flatMap((qualifier) => {
      const found = extracted.find(([token]) => !titles.has(token) && qualifier.tokens.has(token));
      return found ? [{ ...qualifier, label: found[1].label }] : [];
    });
    const named = extracted.filter(
      ([token, term]) =>
        (term.label.length > 2 || term.skill || proper.has(token)) && !isQualifier(token),
    );
    const isSkill = ([token, term]: (typeof named)[number]) =>
      term.skill || proper.has(term.label) || proper.has(token);
    // Offered as the alternative to a skill, a word is one too ("Kafka" opening "Kafka or
    // RabbitMQ").
    const skillRoots = new Set(named.filter(isSkill).map(([token]) => find(token)));
    const skills = named.filter((entry) => isSkill(entry) || skillRoots.has(find(entry[0])));
    const picked = (
      skills.length ? skills : named.filter(([, term]) => term.label.length > 3)
    ).slice(0, MAX_TERMS);
    const groups = new Map<string, Array<[string, string]>>();
    for (const [token, term] of picked) {
      const root = find(token);
      groups.set(root, [...(groups.get(root) ?? []), [token, term.label]]);
    }
    const groupsMet = [...groups.values()].filter((members) =>
      members.some(([token]) => held.has(token)),
    ).length;
    const termsMet = groups.size === 0 || groupsMet === groups.size;

    // A qualifier is shown by a line naming it: beside the skill for a credential, or under a
    // heading naming it.
    const showsQualifier = (
      entry: (typeof resumeLines)[number],
      qualifier: (typeof qualifiers)[number],
    ) =>
      [...qualifier.tokens].some(
        (token) => entry.holds.has(token) || (qualifier.sameLine && entry.context.has(token)),
      ) &&
      (!qualifier.sameLine || !skills.length || picked.some(([token]) => entry.holds.has(token)));
    // A credential ("AWS certification") is met by a certification row naming the skill, or any
    // row if the ask names none; the row is the evidence.
    const rowShows = (row: (typeof certificationRows)[number]) =>
      !skills.length || picked.some(([token]) => row.holds.has(token));
    const matchingRows = qualifiers.some((qualifier) => qualifier.sameLine)
      ? certificationRows.filter(rowShows)
      : [];
    const credentialRows = matchingRows.filter((row) => !row.lapsed);
    // Only lapsed rows: they show the credential was sought, not that it is held. The
    // certifications section's lines, which repeat them, show nothing more.
    const lapsedRows = credentialRows.length ? [] : matchingRows;
    const qualifiersShown = qualifiers.map(
      (qualifier) =>
        (qualifier.sameLine && credentialRows.length > 0) ||
        resumeLines.some(
          (entry) =>
            (!lapsedRows.length || entry.kind !== "certifications") &&
            showsQualifier(entry, qualifier),
        ),
    );
    const qualifiersMet = qualifiersShown.every(Boolean);
    const terms = [
      ...picked.map(([token, term]) => ({ term: term.label, found: held.has(token) })),
      ...qualifiers.map((qualifier, i) => ({ term: qualifier.label, found: qualifiersShown[i]! })),
    ];
    // Beside a row, the certifications section's own lines would only repeat it.
    const termEvidence = [
      ...new Set([
        ...[...credentialRows, ...lapsedRows].map((row) => row.line),
        ...evidenceFor(
          (entry) =>
            (!matchingRows.length || entry.kind !== "certifications") &&
            (picked.some(([token]) => entry.holds.has(token)) ||
              qualifiers.some((qualifier) => showsQualifier(entry, qualifier))),
        ),
      ]),
    ].slice(0, MAX_EVIDENCE);
    // An unshown activity or credential holds a requirement below met.
    const qualified = (status: Status): Status =>
      qualifiersMet ? status : weaker(status, "partial");

    // The field counts only when it is a named subject ("Nursing"), not a plain word.
    const education = resumeLines.filter((entry) => entry.rank === EVIDENCE_RANK.education);
    const educationHolds = new Set(education.flatMap((entry) => [...entry.holds]));
    // A field the ask abbreviates ("CS") is held by the words it stands for ("Computer Science",
    // `fieldAbbreviations`) in a degree's own words, never in its school's ("Colorado State").
    const abbreviates = (label: string) => {
      // Schema-defaulted; a hand-built policy may lack it.
      const words = own(km.requirements.fieldAbbreviations ?? {}, label.toLowerCase());
      const field = words && wordListRegex([escapeRegex(words)]);
      return (
        !!field &&
        education.some((entry) =>
          field.test(
            parsed.education.reduce((line, { school }) => line.replace(school, " "), entry.line),
          ),
        )
      );
    };
    // What the years are of ("BS in CS and 5+ years of Python") is not the degree's field.
    const fieldMet = (yearsGroups: ReadonlySet<string>) =>
      skills.length === 0 ||
      [...groups].every(
        ([root, members]) =>
          yearsGroups.has(root) ||
          members.some(([token, label]) => educationHolds.has(token) || abbreviates(label)),
      );

    const degreeVerdictOf = (yearsGroups: ReadonlySet<string>) => {
      if (!degree) return null;
      const have = parsed.highestIsced;
      const met = have !== null && have >= degree.isced;
      const equivalent =
        !met &&
        matchers.equivalence.test(ask) &&
        (parsed.monthsOfExperience ?? 0) >= EQUIVALENT_MONTHS;
      return {
        met,
        status: (met && fieldMet(yearsGroups)
          ? "met"
          : met || equivalent
            ? "partial"
            : "missing") as Status,
        detail: `${have === null ? "No degree read" : `${ISCED_LABELS[have]} read`}; ${ISCED_LABELS[degree.isced]} asked${equivalent ? ", or equivalent experience" : ""}`,
      };
    };
    const degreeVerdict = degreeVerdictOf(NONE);

    const askedYears = years ? yearsAsked(years[1], km) : null;
    if (years && askedYears !== null) {
      const have = parsed.monthsOfExperience === null ? null : parsed.monthsOfExperience / 12;
      // What the years are of: the named skills, else the plainer words, counted over the dated
      // roles naming them. Beside a degree, only the years' own clause counts ("BS in Computer
      // Science and 5+ years" names the degree's field, not the years'), and only what follows a
      // widened field or its equivalent ("BS in CS or a related field with 4+ years" asks for 4
      // years of any work).
      const scope = levels.length
        ? (() => {
            const clauses = clauseBreak(policy.resumeParse);
            const degreeEnd = Math.max(
              0,
              ...placed.filter(({ end }) => end <= years.index).map(({ end }) => end),
            );
            let head = ask.slice(degreeEnd, years.index).split(clauses).at(-1) ?? "";
            if (eitherAsk) head = head.split(matchers.alternation).at(-1) ?? "";
            head = head.split(matchers.equivalences).at(-1) ?? "";
            const tail = ask.slice(years.index + years[0].length).split(clauses)[0] ?? "";
            const inClause = extractVocabulary(`${head} ${tail}`, km, vocab);
            return picked.filter(([token]) => inClause.has(token));
          })()
        : picked;
      const labels = [...new Set(scope.map(([, term]) => term.label))].join(", ");
      const scopeGroups = new Set(scope.map(([token]) => find(token)));
      const scopeHeld = [...scopeGroups].filter((root) =>
        groups.get(root)?.some(([token]) => held.has(token)),
      ).length;
      const yearsVerdict = ((): { status: Status; detail: string } => {
        if (have === null)
          return {
            status: "missing",
            detail: `No dated roles to count; ${askedYears} years asked`,
          };
        if (!scope.length)
          return {
            status: have >= askedYears ? "met" : "missing",
            detail: `${Math.floor(have)} years in the work history, ${askedYears} asked`,
          };
        // Named skills: roles naming any, all held somewhere. Plain words: roles naming the
        // whole field ("software engineering" is not met by a sales role).
        const scopeMembers = new Map<string, string[]>();
        for (const [token] of scope)
          scopeMembers.set(find(token), [...(scopeMembers.get(find(token)) ?? []), token]);
        const inRoles =
          (monthsOfExperience(rolesWith([...scopeMembers.values()], !skills.length), now) ?? 0) /
          12;
        const counted = `${Math.floor(inRoles)} years in roles naming ${labels}, ${askedYears} asked`;
        if (inRoles >= askedYears)
          return {
            status: skills.length && scopeHeld < scopeGroups.size ? "partial" : "met",
            detail: counted,
          };
        if (scopeHeld === 0)
          return {
            status: "missing",
            detail: `The resume does not name ${labels}; ${askedYears} years asked`,
          };
        return { status: "partial", detail: counted };
      })();
      // "A Master's and 5+ years": as met as the weaker. "A Bachelor's or 4+ years": the stronger.
      const degreeOf = degreeVerdictOf(scopeGroups);
      const status = !degreeOf
        ? yearsVerdict.status
        : eitherAsk
          ? stronger(yearsVerdict.status, degreeOf.status)
          : weaker(yearsVerdict.status, degreeOf.status);
      return {
        ...base,
        kind: "experience",
        status: qualified(status),
        terms,
        evidence: termEvidence,
        detail: degreeOf ? `${yearsVerdict.detail}; ${degreeOf.detail}` : yearsVerdict.detail,
      } satisfies AtsRequirement;
    }

    if (degreeVerdict && degree) {
      // The lines holding the degree: a certificate in the education section is no Bachelor's.
      const levelled = evidenceFor(
        (entry) =>
          entry.rank === EVIDENCE_RANK.education &&
          lineLevel(entry.line) >= (degreeVerdict.met ? degree.isced : 0),
      );
      return {
        ...base,
        kind: "education",
        status: degreeVerdict.status,
        terms,
        evidence:
          levelled.length || !degreeVerdict.met
            ? levelled
            : evidenceFor((entry) => entry.rank === EVIDENCE_RANK.education),
        detail: degreeVerdict.detail,
      } satisfies AtsRequirement;
    }

    // A skill only a lapsed row shows was sought, not held: partial, saying why.
    const soughtRows = certificationRows.filter(
      (row) =>
        row.lapsed &&
        [...groups.values()].some(
          (members) =>
            !members.some(([token]) => held.has(token)) &&
            members.some(([token]) => lapsedTokens.has(token) && row.holds.has(token)),
        ),
    );
    const groupsStatus: Status = termsMet
      ? "met"
      : groupsMet > 0 || soughtRows.length
        ? "partial"
        : "missing";
    const qualifierStatus: Status = qualifiersMet
      ? "met"
      : qualifiersShown.some(Boolean) || lapsedRows.length
        ? "partial"
        : "missing";
    // Why a row naming the ask is not held; not a row naming something else ("Kubernetes:
    // expired 2022" for "Azure certification", Azure being no skill the policy names).
    const namesAsk = (row: (typeof certificationRows)[number]) =>
      !picked.length || picked.some(([token]) => row.holds.has(token));
    const lapsed = [
      ...new Set([
        ...(qualifiersMet ? [] : lapsedRows.filter(namesAsk).map((row) => row.lapsed)),
        ...soughtRows.map((row) => row.lapsed),
      ]),
    ];
    return {
      ...base,
      kind: "skills",
      status:
        groups.size === 0
          ? qualifiers.length
            ? qualifierStatus
            : "unverifiable"
          : qualified(groupsStatus),
      terms,
      evidence: termEvidence,
      ...(lapsed.length ? { detail: lapsed.join("; ") } : {}),
    } satisfies AtsRequirement;
  });
  const allLines = sections.flatMap((section) => section.lines);
  const seniority = seniorityRequirement(jobText, allLines, parsed, policy, matchers);
  return seniority ? [seniority, ...judged] : judged;
}
