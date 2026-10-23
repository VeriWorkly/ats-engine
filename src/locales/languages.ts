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
      placeNames: union(rp.placeNames, v.placeNames),
      workplaceWords: union(rp.workplaceWords, v.workplaceWords),
      organisationWords: union(rp.organisationWords, v.organisationWords),
      openEnded: union(rp.openEnded, v.openEnded),
      rangeWords: union(rp.rangeWords, v.rangeWords),
      sinceWords: union(rp.sinceWords, v.sinceWords),
      lineEndDateWords: union(rp.lineEndDateWords, v.lineEndDateWords),
      leaveWords: union(rp.leaveWords, v.leaveWords),
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
      softSkills: union(km.softSkills, v.softSkills),
      buzzwords: union(km.buzzwords, v.buzzwords),
      pluralSuffixes: union(km.pluralSuffixes, v.pluralSuffixes),
      nounsCapitalized: km.nounsCapitalized || Boolean(v.nounsCapitalized),
      proseNames: { ...km.proseNames, enabled: km.proseNames.enabled && v.proseNames !== false },
      requirements: {
        ...km.requirements,
        yearsPatterns: union(km.requirements.yearsPatterns, v.requirements?.yearsPatterns),
        equivalence: union(km.requirements.equivalence, v.requirements?.equivalence),
        authorization: union(km.requirements.authorization, v.requirements?.authorization),
        clearance: union(km.requirements.clearance, v.requirements?.clearance),
        languagePatterns: union(km.requirements.languagePatterns, v.requirements?.languagePatterns),
        languageNames: { ...km.requirements.languageNames, ...v.requirements?.languageNames },
        seniorityLevels: km.requirements.seniorityLevels.map((level) => ({
          ...level,
          patterns: union(level.patterns, v.requirements?.seniorityLevels?.[level.name]),
        })),
      },
    },
  };
}

export const DETECTION_SAMPLE = 20_000;

/** What a language is recognised by: a pack, or a policy's own `text` (no script). */
type Detection = Pick<AtsLanguagePack, "detectionWords"> & { script?: string | undefined };

const detectionOf = memo((pack: Detection) => ({
  words: new Set(pack.detectionWords.map((word) => word.toLowerCase())),
  script: pack.script ? new RegExp(`\\p{Script=${pack.script}}`, "gu") : undefined,
}));

/** A text's opening, as language detection reads it. */
type Sample = { text: string; words: string[] };

/**
 * The words are taken from everything but email addresses and URLs, which spell names rather
 * than a language: "ananya.das@gmail.com" and "linkedin.com/in/ananya-das" are not German.
 * Split on whitespace rather than matched by a pattern, which a long unbroken token would make
 * quadratic. A word in capitals among lower-case words is an acronym, no evidence of a language:
 * "MIT" in "BSc, MIT, 2016" is not German "mit", nor "AB" in "Volvo AB". On a line all in
 * capitals case says nothing, so a heading's words ("AUSBILDUNG UND STUDIUM") still count.
 */
export function sampleOf(text: string): Sample {
  const sample = text.slice(0, DETECTION_SAMPLE);
  const words: string[] = [];
  for (const line of sample.split("\n")) {
    const prose = line
      .split(/\s+/)
      .filter((token) => !/[@/]/.test(token))
      .join(" ");
    const found = prose.match(/\p{L}[\p{L}\p{M}]*/gu) ?? [];
    const lowerCase = found.some((word) => word !== word.toUpperCase());
    for (const word of found) if (!lowerCase || !isAcronym(word)) words.push(word.toLowerCase());
  }
  return { text: sample, words };
}

/** Two or more letters, all capitals ("MIT", "DAS"); a script without case has none. */
const isAcronym = (word: string) =>
  word.length > 1 && word === word.toUpperCase() && word !== word.toLowerCase();

/**
 * Whether the text is written, at least partly, in the pack's language.
 *
 * A script decides outright when it covers a fair share of the letters: a Hindi resume is
 * Devanagari, whatever English terms it carries. A Latin-script language is recognised by its
 * detection words — at least three different ones, and at least 3% of all words, so a German
 * company name in an English resume ("Müller und Söhne") does not make the resume German, and
 * neither does a surname that is one of the words ("Das") however often it is repeated.
 *
 * Measured against `base`, the policy's own language, a Latin-script language must also have
 * more of its words in the text than the base has of its own: how a resume in a language with no
 * pack is told from an English one naming "El Paso". A pack's vocabulary is attached without it,
 * since it only adds words; `outweighs` decides what the pack's language then governs.
 */
export function isWrittenIn({ text, words }: Sample, pack: Detection, base?: Detection) {
  const detection = detectionOf(pack);
  if (detection.script) {
    const letters = text.match(/[\p{L}\p{M}]/gu)?.length ?? 0;
    const inScript = text.match(detection.script)?.length ?? 0;
    return inScript >= 20 && inScript / Math.max(letters, 1) >= 0.15;
  }
  const hits = words.filter((word) => detection.words.has(word));
  const own = base ? detectionOf(base).words : undefined;
  return (
    new Set(hits).size >= 3 &&
    hits.length / Math.max(words.length, 1) >= 0.03 &&
    (!own || hits.length > words.filter((word) => own.has(word)).length)
  );
}

/** Whether a line holds any of the language's detection words, or a letter of its script. */
export const showsAny = (line: string, pack: Detection) => {
  const { script, words } = detectionOf(pack);
  return script ? line.search(script) >= 0 : sampleOf(line).words.some((word) => words.has(word));
};

/**
 * Whether a pack's language, rather than the policy's own, is what the text is written in: a
 * script pack always is; a Latin-script one unless the text holds more of the base's detection
 * words than of its own. Measured on a resume's bullets, where its dates and the writing rules
 * are, not on headings or a summary: a German CV may head its sections "Skills" and "Experience",
 * and an English one may open with a French summary or name "Banque Nationale du Canada".
 */
export function outweighs({ words }: Sample, pack: Detection, base: Detection) {
  if (detectionOf(pack).script) return true;
  const count = (detection: Detection) =>
    words.filter((word) => detectionOf(detection).words.has(word)).length;
  return count(base) <= count(pack);
}

/**
 * ISO 639-2 "undetermined": what a resume is read in when it is written neither in the policy's
 * own language nor in an attached pack's. A rule limited to some `languages` is dropped for it.
 */
export const UNDETERMINED = "und";

/**
 * The language a resume no attached pack recognises is read in: the policy's own, unless it is
 * recognised as written in one of `text.otherLanguages`, with more of its words than the policy's
 * own has, and not in the policy's own as well. Only what a text has decides, never what it
 * lacks: a short English resume, or one of terse bullets, holds few English function words, and
 * fewer still of another language's, even naming "El Paso" or "Banque Nationale du Canada".
 */
export function baseLanguageOf(policy: AtsEnginePolicy, sample: Sample) {
  const { text } = policy;
  return !isWrittenIn(sample, text) &&
    text.otherLanguages.some((other) => isWrittenIn(sample, other, text))
    ? UNDETERMINED
    : text.language;
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
