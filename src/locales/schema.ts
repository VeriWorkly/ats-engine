import { isSupportedCountry, type CountryCode } from "libphonenumber-js/min";
import * as z from "zod/mini";

import {
  cefrLevels,
  iscedDegrees,
  monthNumber,
  regexString,
  seasonRanges,
  scriptName,
  term,
  wordList,
} from "../policy/primitives.js";

/**
 * Locale packs: the vocabulary a resume in one language, or from one country, is written in. A
 * pack is a fragment of a policy's vocabulary: every field is optional, lists are added to the
 * policy's own and patterns are added as alternatives. Rules, weights and thresholds are the
 * policy's alone, except the few a region pack may adjust by rule id. Packs are plain data (see
 * LOCALES.md).
 */

const optionalList = (label: string) => z.optional(wordList(label));

const vocabularyShape = {
  /** Section heading patterns, each added as an alternative to the policy's own. */
  sections: z.optional(
    z.partial(
      z.object({
        experience: regexString("sections.experience"),
        education: regexString("sections.education"),
        skills: regexString("sections.skills"),
        projects: regexString("sections.projects"),
        certifications: regexString("sections.certifications"),
        languages: regexString("sections.languages"),
        other: regexString("sections.other"),
      }),
    ),
  ),
  /** Level words of spoken languages and the CEFR level each states: "fließend" → C1. */
  languageLevels: z.optional(cefrLevels("languageLevels")),
  /** Words around a certification's dates and issuer: "gültig bis", "ausgestellt von". */
  credentialWords: z.optional(
    z.object({
      issued: optionalList("credentialWords.issued"),
      expires: optionalList("credentialWords.expires"),
      expiresAfter: optionalList("credentialWords.expiresAfter"),
      issuer: optionalList("credentialWords.issuer"),
      id: optionalList("credentialWords.id"),
    }),
  ),
  months: z.optional(z.record(z.string().check(z.minLength(1)), monthNumber)),
  /** Seasons a term is dated by, as the first and last month each covers: "Sommer 2019". */
  seasons: z.optional(seasonRanges),
  /** Units of a role's printed duration: "4 Jahre 9 Monate". */
  durationUnits: optionalList("durationUnits"),
  /** Labels a name is written under: "Name: …". */
  nameLabels: optionalList("nameLabels"),
  /** Letters after a name ("Dipl.-Ing.", "CA"), and codes that name a region, not a credential ("MH", "KA"). */
  postNominals: optionalList("postNominals"),
  regionCodes: optionalList("regionCodes"),
  /** Countries and states in the pack's language: "Deutschland", "Bayern". */
  placeNames: optionalList("placeNames"),
  /** Words opening a date range: "von", "du", "desde". */
  rangeOpeners: optionalList("rangeOpeners"),
  /** Words between a month and its year: "de" in "marzo de 2020". */
  monthYearJoiners: optionalList("monthYearJoiners"),
  /** Larger cities, in the pack's spelling: "München", "Lille", "पुणे". */
  cityNames: optionalList("cityNames"),
  workplaceWords: optionalList("workplaceWords"),
  organisationWords: optionalList("organisationWords"),
  openEnded: optionalList("openEnded"),
  rangeWords: optionalList("rangeWords"),
  sinceWords: optionalList("sinceWords"),
  /** Open ends and since words that date a role only where their date ends the line: "से". */
  lineEndDateWords: optionalList("lineEndDateWords"),
  /** Time off dated like a role, which counts as none: "Elternzeit", "congé parental". */
  leaveWords: optionalList("leaveWords"),
  employerWords: optionalList("employerWords"),
  titleWords: optionalList("titleWords"),
  schoolWords: optionalList("schoolWords"),
  documentTitles: optionalList("documentTitles"),
  nameParticles: optionalList("nameParticles"),
  dateOfBirthLabels: optionalList("dateOfBirthLabels"),
  headingConnectors: optionalList("headingConnectors"),
  degrees: z.optional(iscedDegrees),
  contentLineVerbs: optionalList("contentLineVerbs"),
  actionVerbs: optionalList("actionVerbs"),
  /** Set for a verb-final language; see `text.actionVerbAnywhere`. */
  actionVerbAnywhere: z.optional(z.boolean()),
  injectionPhrases: optionalList("injectionPhrases"),
  /** Added to `keywordMatch.requirements`. */
  requirements: z.optional(
    z.partial(
      z.object({
        yearsPatterns: z.array(regexString("requirements.yearsPatterns")),
        equivalence: wordList("requirements.equivalence"),
        authorization: wordList("requirements.authorization"),
        clearance: wordList("requirements.clearance"),
        languagePatterns: z.array(regexString("requirements.languagePatterns")),
        languageNames: z.record(z.string().check(z.minLength(1)), z.string().check(z.minLength(1))),
        /** Patterns added to the seniority level of that name ("entry": "werkstudent(?:in)?"). */
        seniorityLevels: z.record(
          z.string().check(z.minLength(1)),
          wordList("requirements.seniorityLevels"),
        ),
      }),
    ),
  ),
  /** Job-posting section heading patterns, added as alternatives. */
  jobSections: z.optional(
    z.partial(
      z.object({
        required: regexString("jobSections.required"),
        preferred: regexString("jobSections.preferred"),
        responsibilities: regexString("jobSections.responsibilities"),
        excluded: regexString("jobSections.excluded"),
      }),
    ),
  ),
  alternationWords: optionalList("alternationWords"),
  stopwords: z.optional(z.array(term)),
  /**
   * Soft skills a posting asks for in the language ("Teamfähigkeit", "नेतृत्व"), added to
   * `keywordMatch.softSkills`; a multi-word one is matched as a phrase.
   */
  softSkills: z.optional(z.array(term)),
  buzzwords: z.optional(z.array(term)),
  pluralSuffixes: optionalList("pluralSuffixes"),
  /** Set for a language that capitalises every noun; see `keywordMatch.nounsCapitalized`. */
  nounsCapitalized: z.optional(z.boolean()),
  /**
   * `false` for a language whose capitals say nothing about a name, such as one written in a
   * script without case; see `keywordMatch.proseNames`.
   */
  proseNames: z.optional(z.boolean()),
};

/**
 * `verified`: a named maintainer reads the language natively and the pack meets the field
 * accuracy target on its fixture set. `community`: contributed and tested, not yet signed off.
 */
const status = z.enum(["verified", "community"]);

const packMeta = {
  name: z.string().check(z.minLength(1)),
  status,
  maintainers: z._default(z.array(z.string().check(z.minLength(1))), []),
};

export const languagePackSchema = z
  .object({
    ...vocabularyShape,
    /** ISO 639-1 (or 639-3) code: "de", "hi". */
    id: z.string().check(z.regex(/^[a-z]{2,3}$/, "an ISO 639 language code")),
    ...packMeta,
    /**
     * The script the language is written in when it is not Latin ("Devanagari"). Text with a
     * fair share of letters in it is read as this language, whatever its words.
     */
    script: z.optional(scriptName),
    /**
     * Words common in the language and rare in English — function words, mostly — by which a
     * text in a Latin script is recognised as written in it. Not the stopword list: that one
     * may share words with English ("will", "also") and recognition must not.
     */
    detectionWords: z._default(z.array(z.string().check(z.minLength(1))), []),
    /** The region assumed for a resume in this language when nothing more specific says. */
    defaultRegion: z.optional(z.string().check(z.regex(/^[A-Z]{2}$/))),
  })
  .check(
    z.refine((pack) => pack.script !== undefined || pack.detectionWords.length >= 10, {
      message: "a language pack needs a script or at least ten detection words",
    }),
  );

export const regionPackSchema = z.object({
  ...vocabularyShape,
  /** ISO 3166-1 alpha-2: "DE", "IN". */
  id: z.string().check(z.regex(/^[A-Z]{2}$/, "an ISO 3166 country code")),
  ...packMeta,
  /**
   * The country a national phone number is read as. Typed as the `CountryCode` the check proves,
   * as zod's `.refine` with a type guard would type it.
   */
  phoneCountry: z
    .string()
    .check(
      z.refine((code) => isSupportedCountry(code), "not a country libphonenumber supports"),
    ) as z.ZodMiniString & z.ZodMiniType<CountryCode, string>,
  dateOrder: z.enum(["MDY", "DMY", "YMD"]),
  /**
   * Adjustments to the attached policy's rules, by rule id: a convention that differs by country
   * (a date of birth, a photo) is weighed differently there. `weight` replaces a rule's weight,
   * or every non-zero band weight of a banded rule. An id the policy does not have is ignored.
   */
  rules: z._default(
    z.record(
      z.string().check(z.minLength(1)),
      z.object({
        weight: z.optional(z.number().check(z.gte(0))),
        severity: z.optional(z.enum(["info", "warning", "error"])),
      }),
    ),
    {},
  ),
  /**
   * Turns on the age advice (never scored) where a resume that lets a reader work out the
   * candidate's age invites age bias and recruiters expect none: a graduation year more than
   * `graduationYears` back, more than `experienceYears` years of experience stated or dated.
   * Leave it out where an age on a resume is customary.
   */
  ageAdvice: z.optional(
    z.partial(
      z.object({
        graduationYears: z.number().check(z.int(), z.gt(0)),
        experienceYears: z.number().check(z.int(), z.gt(0)),
      }),
    ),
  ),
});

/** A validated language pack, defaults applied. See LOCALES.md. */
export type AtsLanguagePack = z.output<typeof languagePackSchema>;
/** A language pack as written: fields with defaults may be left out. */
export type AtsLanguagePackInput = z.input<typeof languagePackSchema>;
/** A validated region pack, defaults applied. See LOCALES.md. */
export type AtsRegionPack = z.output<typeof regionPackSchema>;
/** A region pack as written: fields with defaults may be left out. */
export type AtsRegionPackInput = z.input<typeof regionPackSchema>;
/** The vocabulary fields both kinds of pack carry. */
export type AtsVocabulary = Pick<AtsLanguagePack, keyof typeof vocabularyShape>;
