import { degreeLevels } from "../parser/education.js";
import type { AtsEnginePolicy } from "../policy/schema.js";
import { VOCABULARY_TOKEN } from "../text/text.js";
import type { AtsKeywordGroups } from "../types.js";
import { alternationGroups } from "./alternation.js";
import { isOfferLine, segmentJob, withoutIgnored, type JobSectionKind } from "./jobSections.js";
import { proseNames } from "./proseNames.js";
import { requirementLines } from "./requirements.js";
import {
  buildVocabulary,
  canonicalize,
  extractVocabulary,
  properNounTokens,
  resumeCapabilities,
} from "./vocabulary.js";

export type JobMatch = {
  score: number | null;
  /** The groups joined, hard first, at most 12. */
  matched: string[];
  missing: string[];
  /** Each at most 12. */
  matchedGroups: AtsKeywordGroups;
  missingGroups: AtsKeywordGroups;
  /** How many terms each list holds before the cut. */
  counts: { matched: number; missing: number };
};

/** At most this many terms in each list the report shows. */
const LISTED = 12;

// A function: the report hands these arrays to the caller, who may mutate them.
const noMatch = (): JobMatch => ({
  score: null,
  matched: [],
  missing: [],
  matchedGroups: { hard: [], soft: [] },
  missingGroups: { hard: [], soft: [] },
  counts: { matched: 0, missing: 0 },
});

type Listed = { label: string; weight: number; skill: boolean; soft: boolean };

/** Hard terms lead, then soft skills; within each, recognised skills lead, then by weight. */
function listed(terms: Listed[]) {
  terms.sort(
    (a, b) =>
      Number(a.soft) - Number(b.soft) || Number(b.skill) - Number(a.skill) || b.weight - a.weight,
  );
  const hard = terms.filter((term) => !term.soft).map((term) => term.label);
  const soft = terms.filter((term) => term.soft).map((term) => term.label);
  return {
    all: [...hard, ...soft].slice(0, LISTED),
    groups: { hard: hard.slice(0, LISTED), soft: soft.slice(0, LISTED) },
  };
}

/**
 * A posting line as the keyword match reads it: without text that is never a keyword (a
 * "City, ST" location) and without its degree, which is matched by level (`highestIsced`).
 */
function readPostingLine(line: string, policy: AtsEnginePolicy) {
  let text = withoutIgnored(line, policy);
  const levels = degreeLevels(text, policy);
  for (const { matched } of levels) text = text.replace(matched, " ");
  // Named together, levels are usually alternatives ("BS/MS"): the lowest is the bar.
  const lowest = levels.reduce<(typeof levels)[number] | null>(
    (low, level) => (low === null || level.isced < low.isced ? level : low),
    null,
  );
  return { text, degree: lowest };
}

/**
 * Scores the resume against the posting. Two defences keep boilerplate out of the score: section
 * scoping drops "About us", benefits and EEO copy (needs headings), and specificity weighting
 * discounts ordinary English against recognised skills and proper nouns (works on any posting).
 * Names are left out altogether: every word of `company` and the words the posting writes only
 * as names in its prose (`proseNames`).
 */
export function computeJobMatch(
  resumeText: string,
  jobDescription: string | undefined,
  policy: AtsEnginePolicy,
  /** The resume's highest ISCED level, which a degree the posting names is matched against. */
  highestIsced: number | null = null,
  /** The employer that posted the job; every word of it is left out of the keywords. */
  company?: string,
): JobMatch {
  const km = policy.keywordMatch;
  const jobText = typeof jobDescription === "string" ? jobDescription.trim() : "";
  if (!jobText) return noMatch();

  const vocab = buildVocabulary(km);
  const sections = segmentJob(jobText, policy);
  const proper = properNounTokens(jobText, km.nounsCapitalized);
  const names = proseNames(sections, km, vocab);
  // Untyped callers send anything; a company name is short.
  if (typeof company === "string")
    for (const word of company.slice(0, 200).toLowerCase().match(VOCABULARY_TOKEN) ?? []) {
      const token = canonicalize(word, km, vocab);
      if (token) names.add(token);
    }

  const sectionWeight: Record<JobSectionKind, number> = {
    required: km.requiredWeight,
    preferred: km.preferredWeight,
    responsibilities: km.responsibilitiesWeight,
    body: km.defaultWeight,
    excluded: 0,
  };

  // The employer's name, from the heading of its own section ("About Acme Robotics"), is never
  // something a candidate is missing, unless a requirement names the word itself ("About GitLab"
  // over "Experience with GitLab CI").
  const headings = sections.filter((section) => section.kind === "excluded" && section.heading);
  const asked = headings.length
    ? extractVocabulary(
        requirementLines(jobText, policy)
          .map((line) => line.text)
          .join("\n"),
        km,
        vocab,
      )
    : new Map<string, unknown>();
  const employer = new Set(
    headings
      .flatMap((section) => [...extractVocabulary(section.heading!, km, vocab).keys()])
      .filter((token) => !asked.has(token)),
  );

  // A term in more than one block keeps its strongest claim.
  const terms = new Map<string, Listed>();
  const scoredLines: string[] = [];
  // Degree levels the posting asks for: the label it used and the strongest weight.
  const degrees = new Map<number, { label: string; weight: number }>();

  for (const section of sections) {
    const weight = sectionWeight[section.kind];
    if (weight <= 0) continue;
    // What the posting offers ("Salary range $175,000") is not asked of the candidate.
    const read = section.text
      .split("\n")
      .filter((line) => !isOfferLine(line, policy))
      .map((line) => readPostingLine(line, policy));
    // Appended, not spread: enough newlines would exceed the argument-count limit.
    for (const line of read) scoredLines.push(line.text);
    for (const { degree } of read) {
      if (!degree) continue;
      const existing = degrees.get(degree.isced);
      if (!existing || weight > existing.weight)
        degrees.set(degree.isced, { label: degree.matched.toLowerCase(), weight });
    }

    const text = read.map((line) => line.text).join("\n");
    for (const [token, term] of extractVocabulary(text, km, vocab)) {
      if (employer.has(token) || names.has(token)) continue;
      // A soft skill is an ordinary word discounted further, whatever its capitals.
      const soft = vocab.softTokens.has(token);
      const skill = !soft && (term.skill || proper.has(term.label) || proper.has(token));
      // One- and two-letter words mean something only as a named skill or acronym ("Go", "AI");
      // otherwise they are function words ("or", "a").
      if (!skill && term.label.length <= 2) continue;
      const specificity = skill
        ? 1
        : soft
          ? km.generalTermWeight * km.softSkillWeight
          : km.generalTermWeight;
      const scored = weight * specificity;
      const existing = terms.get(token);
      if (!existing || scored > existing.weight)
        terms.set(token, { label: term.label, weight: scored, skill, soft });
    }
  }

  if (terms.size === 0 && degrees.size === 0) return noMatch();

  const held = resumeCapabilities(extractVocabulary(resumeText, km, vocab), vocab);
  const { find, separatorOf } = alternationGroups(scoredLines, km, vocab);

  // Alternatives collapse into one requirement ("Go or Java"), worth one member's weight and
  // satisfied by any of them.
  type Group = {
    members: Array<{ label: string; skill: boolean; soft: boolean }>;
    weight: number;
    matched: string | null;
    /** The word the posting offered the alternatives with: "or", "oder". */
    separator: string;
  };
  const groups = new Map<string, Group>();

  for (const [token, term] of terms) {
    const root = find(token);
    const group = groups.get(root) ?? {
      members: [],
      weight: 0,
      matched: null,
      separator: separatorOf(token) ?? km.alternationWords[0],
    };
    group.members.push({ label: term.label, skill: term.skill, soft: term.soft });
    group.weight = Math.max(group.weight, term.weight);
    if (group.matched === null && held.has(token)) group.matched = term.label;
    groups.set(root, group);
  }

  let totalWeight = 0;
  let matchedWeight = 0;
  const matched: Listed[] = [];
  const missing: Listed[] = [];

  // A degree is met by level, as the requirements judge meets it: any Bachelor's for "BS".
  for (const [isced, { label, weight }] of degrees) {
    totalWeight += weight;
    if (highestIsced !== null && highestIsced >= isced) {
      matchedWeight += weight;
      matched.push({ label, weight, skill: true, soft: false });
    } else missing.push({ label, weight, skill: true, soft: false });
  }

  for (const group of groups.values()) {
    totalWeight += group.weight;
    const skill = group.members.some((member) => member.skill);
    // Soft only when every alternative is: "Python or teamwork" asks for Python.
    const soft = group.members.every((member) => member.soft);
    if (group.matched !== null) {
      matchedWeight += group.weight;
      matched.push({ label: group.matched, weight: group.weight, skill, soft });
    } else {
      // Named as the choice offered ("Go or Java"), not as separate gaps.
      missing.push({
        label: group.members.map((member) => member.label).join(` ${group.separator} `),
        weight: group.weight,
        skill,
        soft,
      });
    }
  }

  const matchedList = listed(matched);
  const missingList = listed(missing);
  return {
    score: totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : null,
    matched: matchedList.all,
    missing: missingList.all,
    matchedGroups: matchedList.groups,
    missingGroups: missingList.groups,
    counts: { matched: matched.length, missing: missing.length },
  };
}
