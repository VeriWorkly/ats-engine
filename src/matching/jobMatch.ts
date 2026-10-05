import { degreeLevels } from "../parser/education.js";
import { policyRegex } from "../policy/regex.js";
import type { AtsEnginePolicy } from "../policy/schema.js";
import { memo } from "../util/memo.js";
import { alternationGroups } from "./alternation.js";
import { segmentJob, type JobSectionKind } from "./jobSections.js";
import {
  buildVocabulary,
  extractVocabulary,
  properNounTokens,
  resumeCapabilities,
} from "./vocabulary.js";

export type JobMatch = {
  score: number | null;
  matched: string[];
  missing: string[];
};

const ignorePatternsOf = memo((patterns: readonly string[]) =>
  patterns.map((pattern) => policyRegex(pattern, "gu")),
);

/**
 * A posting line as the keyword match reads it: without the text that is never a keyword (a
 * "City, ST" location) and without its degree, which is matched by level rather than by word
 * (`highestIsced`), so a B.Tech meets "Bachelor's degree" as the requirements judge says it does.
 */
function readPostingLine(line: string, policy: AtsEnginePolicy) {
  let text = line;
  for (const re of ignorePatternsOf(policy.keywordMatch.ignorePatterns))
    text = text.replace(re, " ");
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
 * Scores the resume against the posting.
 *
 * Two independent defences keep boilerplate out of the score, because either one alone is
 * defeatable. Section scoping drops "About us", benefits, and EEO copy entirely — but only
 * works on a posting that has headings. Specificity weighting discounts ordinary English
 * against recognised skills and proper nouns — and works on any posting, headings or not.
 * Without both, a strong candidate scored around 30 against a posting they matched completely,
 * because "dental", "stipend" and the employer's own name counted the same as "Kubernetes".
 */
export function computeJobMatch(
  resumeText: string,
  jobDescription: string | undefined,
  policy: AtsEnginePolicy,
  /** The resume's highest ISCED level, which a degree the posting names is matched against. */
  highestIsced: number | null = null,
): JobMatch {
  const km = policy.keywordMatch;
  const jobText = typeof jobDescription === "string" ? jobDescription.trim() : "";
  if (!jobText) return { score: null, matched: [], missing: [] };

  const vocab = buildVocabulary(km);
  const sections = segmentJob(jobText, policy);
  const proper = properNounTokens(jobText, km.nounsCapitalized);

  const sectionWeight: Record<JobSectionKind, number> = {
    required: km.requiredWeight,
    preferred: km.preferredWeight,
    responsibilities: km.responsibilitiesWeight,
    body: km.defaultWeight,
    excluded: 0,
  };

  // The employer's name, from the heading of its own section ("About Acme Robotics"): it recurs
  // through the posting and is never something a candidate is missing.
  const employer = new Set(
    sections
      .filter((section) => section.kind === "excluded" && section.heading)
      .flatMap((section) => [...extractVocabulary(section.heading!, km, vocab).keys()]),
  );

  // A term can appear in more than one block. Keep the strongest claim: a skill listed under
  // Requirements is required even if it is mentioned again in the responsibilities prose.
  const terms = new Map<string, { label: string; weight: number; skill: boolean }>();
  const scoredLines: string[] = [];
  /** The degree levels the posting asks for: the label it used and the strongest weight. */
  const degrees = new Map<number, { label: string; weight: number }>();

  for (const section of sections) {
    const weight = sectionWeight[section.kind];
    if (weight <= 0) continue;
    const read = section.text.split("\n").map((line) => readPostingLine(line, policy));
    // Appended rather than spread: a posting is capped at 20k characters, which is more than
    // enough newlines to push a spread past the engine's argument-count limit.
    for (const line of read) scoredLines.push(line.text);
    for (const { degree } of read) {
      if (!degree) continue;
      const existing = degrees.get(degree.isced);
      if (!existing || weight > existing.weight)
        degrees.set(degree.isced, { label: degree.matched.toLowerCase(), weight });
    }

    const text = read.map((line) => line.text).join("\n");
    for (const [token, term] of extractVocabulary(text, km, vocab)) {
      if (employer.has(token)) continue;
      const skill = term.skill || proper.has(term.label) || proper.has(token);
      // One- and two-letter words carry meaning only as a named skill or acronym ("Go", "AI",
      // "JS"). Otherwise they are function words — "in", "to", "or", "a" — and scoring them told
      // candidates to add "or" to their resume, and credited them for having written "a".
      if (!skill && term.label.length <= 2) continue;
      const specificity = skill ? 1 : km.generalTermWeight;
      const scored = weight * specificity;
      const existing = terms.get(token);
      if (!existing || scored > existing.weight)
        terms.set(token, { label: term.label, weight: scored, skill });
    }
  }

  if (terms.size === 0 && degrees.size === 0) return { score: null, matched: [], missing: [] };

  const held = resumeCapabilities(extractVocabulary(resumeText, km, vocab), vocab);
  const { find, separatorOf } = alternationGroups(scoredLines, km, vocab);

  // Alternatives collapse into one requirement worth one member's weight, satisfied by any of
  // them. "Go or Java" is a single ask, not two.
  type Group = {
    members: Array<{ label: string; skill: boolean }>;
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
    group.members.push({ label: term.label, skill: term.skill });
    group.weight = Math.max(group.weight, term.weight);
    if (group.matched === null && held.has(token)) group.matched = term.label;
    groups.set(root, group);
  }

  let totalWeight = 0;
  let matchedWeight = 0;
  const matched: Array<{ label: string; weight: number; skill: boolean }> = [];
  const missing: Array<{ label: string; weight: number; skill: boolean }> = [];

  // A degree is met by level, as the requirements judge meets it: any Bachelor's for "BS".
  for (const [isced, { label, weight }] of degrees) {
    totalWeight += weight;
    if (highestIsced !== null && highestIsced >= isced) {
      matchedWeight += weight;
      matched.push({ label, weight, skill: true });
    } else missing.push({ label, weight, skill: true });
  }

  for (const group of groups.values()) {
    totalWeight += group.weight;
    const skill = group.members.some((member) => member.skill);
    if (group.matched !== null) {
      matchedWeight += group.weight;
      matched.push({ label: group.matched, weight: group.weight, skill });
    } else {
      // Named as the choice the posting actually offered, so the advice reads "Go or Java"
      // rather than listing each alternative as a separate gap.
      missing.push({
        label: group.members.map((member) => member.label).join(` ${group.separator} `),
        weight: group.weight,
        skill,
      });
    }
  }

  // Recognised skills lead both lists regardless of section weight: a missing skill is always
  // more actionable advice than a missing ordinary word, and these lists are what the user is
  // shown and what the AI layer is handed as evidence.
  const rank = (a: { weight: number; skill: boolean }, b: { weight: number; skill: boolean }) =>
    Number(b.skill) - Number(a.skill) || b.weight - a.weight;

  matched.sort(rank);
  missing.sort(rank);

  return {
    score: totalWeight > 0 ? Math.round((matchedWeight / totalWeight) * 100) : null,
    matched: matched.slice(0, 12).map((m) => m.label),
    missing: missing.slice(0, 12).map((m) => m.label),
  };
}
