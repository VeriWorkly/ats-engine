import { isDatedLine } from "../checks/bullets.js";
import { formatCertification, formatSpokenLanguage, ISCED_LABELS } from "../format/index.js";
import { degreeLevels } from "../parser/education.js";
import { canonicalLanguage, cefrLevel, compareCefr } from "../parser/languages.js";
import { monthsOfExperience } from "../parser/tenure.js";
import type { ResumeSection, ResumeSectionKind } from "../parser/sections.js";
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
  properNounTokens,
  resumeCapabilities,
} from "./vocabulary.js";

/**
 * The posting's requirements, one by one, judged against the resume.
 *
 * A single keyword percentage is not how a resume is screened in 2026: an LLM grader reads each
 * qualification and asks whether the resume shows it (Workday HiredScore's per-qualification
 * grades, Ashby's "meets / does not meet" with citations), and a knockout question filters on
 * years, a degree or the right to work before anyone reads at all. This produces that view:
 * each requirement under the posting's Requirements or Preferred heading, its status, the terms
 * it names, and the resume lines that evidence it — so the candidate sees exactly which ask is
 * unmet, and where the resume already answers the rest.
 *
 * Deterministic and explainable like the rest of the engine: no model is involved. A model can
 * read nuance this cannot ("leadership"); what this reports, it can point to.
 */

const MAX_REQUIREMENTS = 25;
const MAX_REQUIREMENT_CHARS = 300;
const MAX_EVIDENCE = 2;
const MAX_TERMS = 6;
/** Lines searched for evidence. A resume has a few hundred; a document past this is not one. */
const MAX_EVIDENCE_LINES = 1_000;
/** Years of dated work that let "or equivalent experience" stand in for a degree. */
const EQUIVALENT_MONTHS = 24;
const WEAK_LANGUAGE = /\b(?:beginner|basic|elementary|limited|a1|a2)\b/iu;

/** A resume section with the heading line that opened it, when one did: "Certifications". */
export type HeadedSection = ResumeSection & { heading?: string };

/**
 * Each section with the line that opened it. `segmentResume` keeps the heading's kind but not
 * its words, and a "Licenses and Certifications" heading is what makes "BLS" under it a
 * credential. Recovered by walking the lines the sections were cut from; when they do not line
 * up, no heading is given.
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
  /** Global: a line may say "proficient in Python" before the language it asks for. */
  languages: RegExp[];
  /** Every language the policy names, in any language: `languageNames` keys and values. */
  languageNames: Set<string>;
  /** Any of those names, as a word, globally: which languages a resume line names. */
  anyLanguage: RegExp;
  /** A line that opens with a language, after any "Label:": "Languages: German (native)". */
  leadingLanguage: RegExp;
  /** A line that states a nationality: "Nationality: German". Never proof of a language. */
  nationality: RegExp;
  equivalence: RegExp;
  /** Global, for cutting "or related field" out of the text between a degree and the years. */
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
  /** The same, global: blanked out to read what else a line says. */
  noSponsorshipAll: RegExp;
  negation: RegExp;
  notHeld: RegExp;
  citizenship: RegExp;
  residence: RegExp;
  clearance: RegExp;
  /** Clearance levels, highest first, each with its rank (0 the lowest) and a global pattern. */
  clearanceLevels: Array<{ name: string; rank: number; pattern: RegExp }>;
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
    // Anchored, and the label bounded, so a long line costs one pass.
    leadingLanguage: new RegExp(
      `^\\s*(?:[^:]{1,40}:\\s*)?${wordListPattern(names)}\\s*(?:$|[(,;:/|–—-])`,
      "iu",
    ),
    nationality: new RegExp(`^\\s*${wordListPattern(km.nationalityLabels)}`, "iu"),
    equivalence: wordListRegex(r.equivalence),
    equivalences: wordListRegex(r.equivalence, "gi"),
    alternation: wordListRegex(km.alternationWords),
    preferred: wordListRegex(km.preferredMarkers),
    preferredAll: wordListRegex(km.preferredMarkers, "gi"),
    authorization: wordListRegex(r.authorization),
    needsSponsorship: wordListRegex(r.needsSponsorship),
    noSponsorship: wordListRegex(r.noSponsorship),
    noSponsorshipAll: wordListRegex(r.noSponsorship, "gi"),
    negation: wordListRegex(r.negation),
    notHeld: wordListRegex(r.notHeld),
    citizenship: wordListRegex(r.citizenship),
    residence: wordListRegex(r.residence),
    clearance: wordListRegex(r.clearance),
    clearanceLevels: r.clearanceLevels
      .map(({ name, patterns }, rank) => ({ name, rank, pattern: wordListRegex(patterns, "gi") }))
      .reverse(),
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

/**
 * The clearance levels a line names, by rank. Read from the highest down, each match blanked
 * before the next level is looked for, so "Top Secret" is not also "Secret".
 */
function clearanceRanks(text: string, matchers: Matchers) {
  const ranks: number[] = [];
  let rest = text;
  for (const { rank, pattern } of matchers.clearanceLevels) {
    const blanked = rest.replace(pattern, (found) => " ".repeat(found.length));
    if (blanked !== rest) ranks.push(rank);
    rest = blanked;
  }
  return ranks;
}

/** A clearance the line says is held: not negated, not pending or past. */
const holdsClearance = (line: string, matchers: Matchers) =>
  matchers.clearance.test(line) && !matchers.negation.test(line) && !matchers.notHeld.test(line);

/**
 * The right to work: met by a statement of it, never by one that says the opposite. A line is
 * read without what says no sponsorship is needed ("not requiring sponsorship"), so its "not"
 * is not taken for a negation; what is left that needs sponsorship is no evidence of the right
 * to work, and evidence against it where the posting rules sponsorship out, and what is left
 * negated ("Cannot work in the US") is no evidence. An ask for citizenship alone is met only by
 * citizenship held, and a line naming permanent residence instead says the candidate does not
 * hold it. Otherwise the question is the application's.
 */
function judgeAuthorization(
  ask: string,
  lines: ReadonlyArray<{ line: string }>,
  matchers: Matchers,
): { status: Status | "unverifiable"; lines: Array<{ line: string }> } {
  const stated = lines.flatMap((entry) => {
    const { line } = entry;
    if (
      !matchers.authorization.test(line) &&
      !matchers.citizenship.test(line) &&
      !matchers.residence.test(line)
    )
      return [];
    const rest = line.replace(matchers.noSponsorshipAll, " ");
    if (matchers.needsSponsorship.test(rest)) return [{ entry, needs: true }];
    return matchers.negation.test(rest) ? [] : [{ entry, needs: false }];
  });
  const shown = stated.filter(({ needs }) => !needs).map(({ entry }) => entry);
  const needing = stated.filter(({ needs }) => needs).map(({ entry }) => entry);
  if (matchers.citizenship.test(ask) && !matchers.residence.test(ask)) {
    const citizen = shown.filter(
      ({ line }) =>
        matchers.citizenship.test(line) &&
        !matchers.residence.test(line) &&
        !matchers.notHeld.test(line),
    );
    if (citizen.length) return { status: "met", lines: citizen };
    const against = [...shown.filter(({ line }) => matchers.residence.test(line)), ...needing];
    return { status: against.length ? "missing" : "unverifiable", lines: against };
  }
  const excludes = matchers.noSponsorship.test(ask) || matchers.needsSponsorship.test(ask);
  if (excludes && needing.length) return { status: "missing", lines: needing };
  return { status: shown.length ? "met" : "unverifiable", lines: shown };
}

/** The word after a position, when only spaces stand before it. */
const NEXT_WORD = /\s*(\p{L}[\p{L}\p{M}'’-]*)/uy;

/**
 * Every language a requirement asks for. In a policy pattern ("fluent in German"), or named as a
 * language on its own — at the end, before punctuation ("English/Spanish", "English (C1)") or
 * before a function word ("English and Spanish"). A name before a plain word describes it: "German
 * enterprise customers" is a market, "the Chinese market" too. `alone` reads the second kind
 * without the first; a line about years or a degree is never only a language.
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
  return [...new Set([...shaped, ...standalone])];
}

/**
 * Whether a resume line lists languages, rather than merely naming one in passing ("launched in
 * the Chinese market", "led UI polish"): it opens with one ("German (native)", "Languages:
 * German"), names two or more, or states one the way a posting asks ("native German speaker").
 * A nationality is not a language: "Nationality: German" lists none.
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

/** Where one clause of a requirement ends: a comma, a semicolon, or the policy's "and" words. */
const clauseBreak = memo(
  (rp: AtsEnginePolicy["resumeParse"]) =>
    new RegExp(`[,;]|${wordListPattern(rp.headingConnectors)}`, "iu"),
);

/**
 * The CEFR level asked of each language: the level its own clause states ("Fluent English, basic
 * Spanish"), else the one level the whole ask states ("Fluent in English and Spanish"), else none.
 * The level words are the resume's (`languageLevels`), so "fluent" asks for C1.
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

/**
 * Whether the text between two asks offers them as alternatives: an alternation word joins
 * them. One the degree's own "or related field" / "or equivalent" carries is not that.
 */
const offersAlternatives = (between: string, matchers: Matchers) =>
  matchers.alternation.test(between.replace(matchers.equivalences, " "));

/**
 * The requirement without the clauses it marks optional — "Bachelor's degree required; MBA a
 * plus" asks for the Bachelor's — blanked rather than cut, so offsets still line up. A line
 * that is optional throughout ("Python preferred") is kept whole and read as preferred.
 *
 * A marker covers the whole of its sentence part (up to a ";") when it opens it on its own
 * ("Ideally, you have 3+ years of Rust"), closes it on its own ("Kafka, ideally"), or closes a
 * list it continues with an alternation word ("Rust, Scala or Elixir is a plus", "Python,
 * Haskell, or OCaml preferred"). Otherwise it covers its own clause: "BS in Computer Science,
 * MS preferred" still asks for the BS.
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

/** The posting's requirement statements: each line, or sentence of a long one, under its headings. */
export function requirementLines(jobText: string, policy: AtsEnginePolicy) {
  const sections = segmentJob(jobText, policy);
  const hasRequired = sections.some((s) => s.kind === "required");
  // A posting with no Requirements heading still lists them — as bullets in its body. So does
  // one whose required heading went unrecognised while its "Nice to have" did not: those
  // bullets are the required items, not nothing.
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
 * after a word that is not a stopword — "Engineering Manager", "Tech Lead" — rather than an
 * activity ("lead engineering teams", "experience managing", "ability to lead").
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
  /** The reference date for a current role's tenure, as everywhere else in the report. */
  now: Date,
): AtsRequirement[] {
  const jobText = typeof jobDescription === "string" ? jobDescription.trim() : "";
  if (!jobText) return [];

  const km = policy.keywordMatch;
  const vocab = buildVocabulary(km);
  const matchers = matchersOf(km);
  const proper = properNounTokens(jobText, km.nounsCapitalized);

  // A credential heading ("Certifications", "Licenses and Certifications") certifies what is
  // listed under it. Recognised, it opened the section; unrecognised, it is a line of its own
  // that names nothing but credentials, and covers the lines after it.
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

  // The resume line by line, each with its section and what it demonstrates. Two bounds keep
  // this linear in practice: only the phrases the resume contains at all are searched for line
  // by line (a tuned policy can carry hundreds), and no more lines than any resume has.
  const ranked = sections
    .flatMap((section) => {
      const heading = (section as HeadedSection).heading;
      // Every line of a certifications section is a credential, whatever its heading calls it.
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
  // The certification rows, each with what it names: a credential asked for is met by one.
  const certificationRows = parsed.certifications.map((row) => ({
    line: formatCertification(row),
    holds: resumeCapabilities(extractVocabulary(`${row.name} ${row.issuer}`, km, vocab), vocab),
  }));

  // What each dated role's lines hold. A role is anchored on its own lines — its dated line and
  // the header lines just above it that name its title or employer — never on a bullet that
  // happens to name an employer ("Integrated billing with the Globex partner API").
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
    const dated = work.flatMap((entry, at) => (isDatedLine(entry.line, policy, now) ? [at] : []));
    const owner = new Array<number>(work.length).fill(-1);
    if (dated.length === parsed.roles.length) {
      // Each role's dated line in order, raised to the header lines above it that name it.
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
      // The roles came from somewhere the lines do not show (a structured document, a hidden
      // line): follow their headers through the lines, still never through a bullet.
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
   * The roles that name what a years ask is of: any of its named skills, or, for a field in
   * plain words ("software engineering"), every word of it — each group by any of its members.
   */
  const rolesWith = (groups: ReadonlyArray<readonly string[]>, every: boolean) =>
    holdingsOfRoles().flatMap((holds, index) => {
      const has = (group: readonly string[]) => group.some((token) => holds.has(token));
      return (every ? groups.every(has) : groups.some(has)) ? [parsed.roles[index]!] : [];
    });
  /** The highest level a resume line names, or -1. */
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

  return lines.map(({ text, importance: heading }) => {
    // What the line asks for, without the clauses it calls a plus.
    const { asked: ask, optional } = withoutOptional(text, matchers);
    const importance = optional ? ("preferred" as const) : heading;
    const base = { text, importance };

    // The right to work and a clearance: settled in the application, unless the resume says.
    if (matchers.authorization.test(text)) {
      const { status, lines: shown } = judgeAuthorization(ask, resumeLines, matchers);
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
      const holds = (entry: { line: string }) => holdsClearance(entry.line, matchers);
      const evidence = evidenceFor(holds);
      // A level asked is met by it or one above; the lowest the ask names is the bar.
      const asked = Math.min(...clearanceRanks(ask, matchers));
      const held = Math.max(
        -1,
        ...resumeLines.filter(holds).flatMap((entry) => clearanceRanks(entry.line, matchers)),
      );
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
    // Every level the line names, highest first, and where in the line each is named. Not a
    // state code after a city: "Office in Boston MA" asks for no Master's.
    const levels = degreeLevels(withoutIgnored(ask, policy), policy);

    // A language: met when the resume names it, in any of the names the packs know for it. Only
    // a name the policy lists is one: "proficient in Python" has the shape of "fluent in German".
    // A line that names one without that shape ("communication skills in English") asks for it
    // too, unless it is about years or a degree. Every language it names is asked for: "Bilingual
    // English/Spanish" is not met by English alone.
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
        // A spoken-language row decides, at the level asked; without one, a line naming the
        // language does, as it always has.
        const row = parsed.spokenLanguages.find(
          (spoken) => canonicalLanguage(spoken.language, policy) === english,
        );
        const level = asked.get(name) ?? null;
        const status: Status | null = row
          ? !level || !row.cefr || compareCefr(row.cefr, level) >= 0
            ? "met"
            : belowLevel(row.cefr, level)
          : resumeLines.some(shows)
            ? "met"
            : null;
        const short = row?.cefr && level && compareCefr(row.cefr, level) < 0;
        return {
          name,
          shows,
          row,
          status,
          detail: short ? `${row.language}: ${row.cefr} read, ${level} asked` : null,
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
        // Unnamed is not absent: a resume written in English rarely says "English". A resume that
        // lists its languages and leaves one off is missing it; one that lists none (a language
        // named in passing is not a list) leaves the question to the application.
        status:
          met === states.length
            ? "met"
            : some
              ? "partial"
              : listsAny()
                ? "missing"
                : "unverifiable",
        terms: states.map(({ name, status }) => ({
          term: name,
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
    // Offered as alternatives ("Bachelor's or Master's", "BS/MS") the levels accept the lowest;
    // asked together ("a Master's and a teaching certificate") the highest is the bar.
    const alternatives = placed.slice(1).some((at, i) => {
      const between = ask.slice(placed[i]!.end, at.start);
      return between.includes("/") || matchers.alternation.test(between);
    });
    const degree = (alternatives ? levels.at(-1) : levels[0]) ?? null;
    // "A Bachelor's degree or 4+ years": either ask meets the line, when an alternation word
    // stands between the years and the degree nearest them — in the clause next to the years,
    // so "in Computer Science, Engineering or a related field, and 3+ years" offers no choice.
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

    // What the requirement names beyond its years and degree. Named skills when it has any —
    // "experience with Python and AWS" is about Python and AWS — else its plainer words.
    const rest = [years?.[0], ...levels.map((level) => level.matched)].reduce<string>(
      (out, matched) => (matched ? out.replace(matched, " ") : out),
      ask,
    );
    // "Go or Java" is one ask: a group is met by any of its members.
    const { find } = alternationGroups([rest], km, vocab);
    const extracted = [...extractVocabulary(rest, km, vocab)];
    // A job title's noun is the title, not the activity: "Manager" in "an Engineering Manager",
    // "Lead" in "Tech Lead" — a title word right after a word of its own.
    const titles = titleNouns(rest, policy, vocab);
    const isQualifier = (token: string) =>
      !titles.has(token) && matchers.qualifiers.some((qualifier) => qualifier.tokens.has(token));
    // An activity or a credential is part of the ask, not a plain word to drop beside a skill:
    // "mentoring" in "mentoring engineers", "certification" in "AWS certification".
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
    // Offered as the alternative to a skill, a word is one too: "Kafka" in "Kafka or RabbitMQ"
    // opens the line, so its capital says nothing, but the choice beside it does.
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

    // A qualifier is shown by a line naming it — beside the skill, for a credential, or under a
    // heading that names the credential ("Certifications").
    const showsQualifier = (
      entry: (typeof resumeLines)[number],
      qualifier: (typeof qualifiers)[number],
    ) =>
      [...qualifier.tokens].some(
        (token) => entry.holds.has(token) || (qualifier.sameLine && entry.context.has(token)),
      ) &&
      (!qualifier.sameLine || !skills.length || picked.some(([token]) => entry.holds.has(token)));
    // A credential asked for ("AWS certification", "PMP certified") is met by a certification
    // row naming the skill, or by any row when the ask names none; the row is the evidence.
    const rowShows = (row: (typeof certificationRows)[number]) =>
      !skills.length || picked.some(([token]) => row.holds.has(token));
    const credentialRows = qualifiers.some((qualifier) => qualifier.sameLine)
      ? certificationRows.filter(rowShows)
      : [];
    const qualifiersShown = qualifiers.map(
      (qualifier) =>
        (qualifier.sameLine && credentialRows.length > 0) ||
        resumeLines.some((entry) => showsQualifier(entry, qualifier)),
    );
    const qualifiersMet = qualifiersShown.every(Boolean);
    const terms = [
      ...picked.map(([token, term]) => ({ term: term.label, found: held.has(token) })),
      ...qualifiers.map((qualifier, i) => ({ term: qualifier.label, found: qualifiersShown[i]! })),
    ];
    // Beside a row, the certifications section's own lines would only repeat it.
    const termEvidence = [
      ...new Set([
        ...credentialRows.map((row) => row.line),
        ...evidenceFor(
          (entry) =>
            (!credentialRows.length || entry.kind !== "certifications") &&
            (picked.some(([token]) => entry.holds.has(token)) ||
              qualifiers.some((qualifier) => showsQualifier(entry, qualifier))),
        ),
      ]),
    ].slice(0, MAX_EVIDENCE);
    /** An unshown activity or credential holds a requirement below met. */
    const qualified = (status: Status): Status =>
      qualifiersMet ? status : weaker(status, "partial");

    // The level is what a knockout filters on. The field counts against it only when it is a
    // named subject ("Nursing"), not a plain word another language's resume would not repeat.
    const educationHolds = new Set(
      resumeLines
        .filter((entry) => entry.rank === EVIDENCE_RANK.education)
        .flatMap((entry) => [...entry.holds]),
    );
    const fieldMet =
      skills.length === 0 ||
      [...groups.values()].every((members) => members.some(([token]) => educationHolds.has(token)));

    // The degree's verdict, when the line names one.
    const degreeVerdict = degree
      ? (() => {
          const have = parsed.highestIsced;
          const met = have !== null && have >= degree.isced;
          const equivalent =
            !met &&
            matchers.equivalence.test(ask) &&
            (parsed.monthsOfExperience ?? 0) >= EQUIVALENT_MONTHS;
          return {
            met,
            status: (met && fieldMet ? "met" : met || equivalent ? "partial" : "missing") as Status,
            detail: `${have === null ? "No degree read" : `${ISCED_LABELS[have]} read`}; ${ISCED_LABELS[degree.isced]} asked${equivalent ? ", or equivalent experience" : ""}`,
          };
        })()
      : null;

    const askedYears = years ? yearsAsked(years[1], km) : null;
    if (years && askedYears !== null) {
      const have = parsed.monthsOfExperience === null ? null : parsed.monthsOfExperience / 12;
      // What the years are of: the named skills, else the line's plainer words ("software
      // engineering"), counted over the dated roles that name them — never the whole work
      // history, or a resume that names the skill in one more true bullet could score lower.
      // Beside a degree, only the words in the years' own clause are what the years are of:
      // "BS in Computer Science and 5+ years of experience" names the degree's field, not the
      // years'.
      const scope = levels.length
        ? (() => {
            const clauses = clauseBreak(policy.resumeParse);
            const degreeEnd = Math.max(
              0,
              ...placed.filter(({ end }) => end <= years.index).map(({ end }) => end),
            );
            let head = ask.slice(degreeEnd, years.index).split(clauses).at(-1) ?? "";
            if (eitherAsk) head = head.split(matchers.alternation).at(-1) ?? "";
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
        // Named skills: the roles naming any of them, and all must be held somewhere. Plain
        // words: the roles naming the whole field — "software engineering" is not met by a
        // sales role that worked with engineering.
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
      // "A Master's and 5+ years": both are asked, so the line is as met as the weaker of the two.
      // "A Bachelor's or 4+ years": either will do, so it is as met as the stronger.
      const status = !degreeVerdict
        ? yearsVerdict.status
        : eitherAsk
          ? stronger(yearsVerdict.status, degreeVerdict.status)
          : weaker(yearsVerdict.status, degreeVerdict.status);
      return {
        ...base,
        kind: "experience",
        status: qualified(status),
        terms,
        evidence: termEvidence,
        detail: degreeVerdict
          ? `${yearsVerdict.detail}; ${degreeVerdict.detail}`
          : yearsVerdict.detail,
      } satisfies AtsRequirement;
    }

    if (degreeVerdict && degree) {
      // The lines that hold the degree, not every line of the education section: a certificate
      // listed there is no evidence of a Bachelor's.
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

    const groupsStatus: Status = termsMet ? "met" : groupsMet > 0 ? "partial" : "missing";
    const qualifierStatus: Status = qualifiersShown.every(Boolean)
      ? "met"
      : qualifiersShown.some(Boolean)
        ? "partial"
        : "missing";
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
    } satisfies AtsRequirement;
  });
}
