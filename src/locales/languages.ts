import type { AtsEnginePolicy } from "../policy/schema.js";
import { memo } from "../util/memo.js";
import type { AtsLanguagePack, AtsVocabulary } from "./schema.js";

/**
 * Language packs: detecting which ones a text is written in, and adding a pack's vocabulary to a
 * policy. Kept apart from regions (resolve.ts), which infer a country from a phone number and so
 * carry the phone metadata: code that only needs a resume's words, such as the AI repair
 * checks, reads them from here without it.
 */

export const union = (base: string[], added?: readonly string[]) =>
  added?.length ? [...new Set([...base, ...added])] : base;
const either = (base: string, added?: string) => (added ? `(?:${base})|(?:${added})` : base);

/** A policy with a pack's vocabulary added to its own: lists joined, patterns as alternatives. */
export function applyVocabulary(policy: AtsEnginePolicy, v: AtsVocabulary): AtsEnginePolicy {
  const { resumeParse: rp, keywordMatch: km, text } = policy;

  const degrees = { ...rp.degrees };
  for (const [level, pattern] of Object.entries(v.degrees ?? {}) as Array<
    [keyof typeof degrees, string | undefined]
  >)
    if (pattern) degrees[level] = degrees[level] ? either(degrees[level], pattern) : pattern;

  return {
    ...policy,
    resumeParse: {
      ...rp,
      sections: {
        experience: either(rp.sections.experience, v.sections?.experience),
        education: either(rp.sections.education, v.sections?.education),
        skills: either(rp.sections.skills, v.sections?.skills),
        projects: either(rp.sections.projects, v.sections?.projects),
        certifications: either(rp.sections.certifications, v.sections?.certifications),
        languages: either(rp.sections.languages, v.sections?.languages),
        other: either(rp.sections.other, v.sections?.other),
      },
      languageLevels: { ...rp.languageLevels, ...v.languageLevels },
      credentialWords: {
        issued: union(rp.credentialWords.issued, v.credentialWords?.issued),
        expires: union(rp.credentialWords.expires, v.credentialWords?.expires),
        issuer: union(rp.credentialWords.issuer, v.credentialWords?.issuer),
        id: union(rp.credentialWords.id, v.credentialWords?.id),
      },
      months: { ...rp.months, ...v.months },
      seasons: { ...rp.seasons, ...v.seasons },
      durationUnits: union(rp.durationUnits, v.durationUnits),
      nameLabels: union(rp.nameLabels, v.nameLabels),
      postNominals: union(rp.postNominals, v.postNominals),
      regionCodes: union(rp.regionCodes, v.regionCodes),
      workplaceWords: union(rp.workplaceWords, v.workplaceWords),
      openEnded: union(rp.openEnded, v.openEnded),
      rangeWords: union(rp.rangeWords, v.rangeWords),
      sinceWords: union(rp.sinceWords, v.sinceWords),
      employerWords: union(rp.employerWords, v.employerWords),
      titleWords: union(rp.titleWords, v.titleWords),
      schoolWords: union(rp.schoolWords, v.schoolWords),
      documentTitles: union(rp.documentTitles, v.documentTitles),
      nameParticles: union(rp.nameParticles, v.nameParticles),
      dateOfBirthLabels: union(rp.dateOfBirthLabels, v.dateOfBirthLabels),
      headingConnectors: union(rp.headingConnectors, v.headingConnectors),
      degrees,
    },
    text: {
      ...text,
      contentLineVerbs: union(text.contentLineVerbs, v.contentLineVerbs),
      actionVerbs: union(text.actionVerbs, v.actionVerbs),
      actionVerbAnywhere: text.actionVerbAnywhere || Boolean(v.actionVerbAnywhere),
      injectionPhrases: union(text.injectionPhrases, v.injectionPhrases),
    },
    keywordMatch: {
      ...km,
      sections: {
        required: either(km.sections.required, v.jobSections?.required),
        preferred: either(km.sections.preferred, v.jobSections?.preferred),
        responsibilities: either(km.sections.responsibilities, v.jobSections?.responsibilities),
        excluded: either(km.sections.excluded, v.jobSections?.excluded),
      },
      alternationWords: union(km.alternationWords, v.alternationWords),
      stopwords: union(km.stopwords, v.stopwords),
      buzzwords: union(km.buzzwords, v.buzzwords),
      pluralSuffixes: union(km.pluralSuffixes, v.pluralSuffixes),
      nounsCapitalized: km.nounsCapitalized || Boolean(v.nounsCapitalized),
      proseNames: { ...km.proseNames, enabled: km.proseNames.enabled && v.proseNames !== false },
      requirements: {
        yearsPatterns: union(km.requirements.yearsPatterns, v.requirements?.yearsPatterns),
        equivalence: union(km.requirements.equivalence, v.requirements?.equivalence),
        authorization: union(km.requirements.authorization, v.requirements?.authorization),
        clearance: union(km.requirements.clearance, v.requirements?.clearance),
        languagePatterns: union(km.requirements.languagePatterns, v.requirements?.languagePatterns),
        languageNames: { ...km.requirements.languageNames, ...v.requirements?.languageNames },
      },
    },
  };
}

export const DETECTION_SAMPLE = 20_000;
const detectionOf = memo((pack: AtsLanguagePack) => ({
  words: new Set(pack.detectionWords.map((word) => word.toLowerCase())),
  script: pack.script ? new RegExp(`\\p{Script=${pack.script}}`, "gu") : undefined,
}));

/** A text's opening, as language detection reads it. */
type Sample = { text: string; words: string[] };

/**
 * The words are taken from everything but email addresses and URLs, which spell names rather
 * than a language: "ananya.das@gmail.com" and "linkedin.com/in/ananya-das" are not German.
 * Split on whitespace rather than matched by a pattern, which a long unbroken token would make
 * quadratic.
 */
export function sampleOf(text: string): Sample {
  const sample = text.slice(0, DETECTION_SAMPLE);
  const prose = sample
    .split(/\s+/)
    .filter((token) => !/[@/]/.test(token))
    .join(" ");
  return { text: sample, words: prose.toLowerCase().match(/\p{L}[\p{L}\p{M}]*/gu) ?? [] };
}

/**
 * Whether the text is written, at least partly, in the pack's language.
 *
 * A script decides outright when it covers a fair share of the letters: a Hindi resume is
 * Devanagari, whatever English terms it carries. A Latin-script language is recognised by its
 * detection words — at least three different ones, and at least 3% of all words, so a German
 * company name in an English resume ("Müller und Söhne") does not make the resume German, and
 * neither does a surname that is one of the words ("Das") however often it is repeated.
 */
export function isWrittenIn({ text, words }: Sample, pack: AtsLanguagePack) {
  const detection = detectionOf(pack);
  if (detection.script) {
    const letters = text.match(/[\p{L}\p{M}]/gu)?.length ?? 0;
    const inScript = text.match(detection.script)?.length ?? 0;
    return inScript >= 20 && inScript / Math.max(letters, 1) >= 0.15;
  }
  const hits = words.filter((word) => detection.words.has(word));
  return new Set(hits).size >= 3 && hits.length / Math.max(words.length, 1) >= 0.03;
}

const inLanguagesCache = memo<AtsEnginePolicy, Map<string, AtsEnginePolicy>>(() => new Map());

/**
 * The policy with the attached language packs `text` is written in applied, and nothing else: no
 * region, no date order. What reading model output against a resume needs ("heute" ends a German
 * role); `localizePolicy` is the full reading `check` uses.
 */
export function inLanguagesOf(policy: AtsEnginePolicy, text: string): AtsEnginePolicy {
  const packs = policy.locales.languages;
  if (!packs.length) return policy;
  const sample = sampleOf(text);
  const languages = packs.filter((pack) => isWrittenIn(sample, pack));
  if (!languages.length) return policy;
  const key = languages.map((pack) => pack.id).join("+");
  const cache = inLanguagesCache(policy);
  let localized = cache.get(key);
  if (!localized) cache.set(key, (localized = languages.reduce(applyVocabulary, policy)));
  return localized;
}
