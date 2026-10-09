import { isSupportedCountry, type CountryCode } from "libphonenumber-js/min";
import * as z from "zod/mini";

import { cefrLevels, iscedDegrees, regexString, term, wordList } from "../policy/primitives.js";

/**
 * Locale packs: the vocabulary a resume in one language, or from one country, is written in.
 *
 * A pack is a fragment of a policy's vocabulary, never a whole policy, so it extends whatever
 * policy it is attached to — the community one or a private one — rather than replacing it.
 * Every field is optional and every list is added to what the policy already has; patterns are
 * added as alternatives. Rules, weights and thresholds are the policy's alone, except the few a
 * region pack may adjust by rule id.
 *
 * Packs are plain JSON-compatible data, validated here, so a new locale is a data contribution
 * (see LOCALES.md), not a code change.
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
      issuer: optionalList("credentialWords.issuer"),
      id: optionalList("credentialWords.id"),
    }),
  ),
  months: z.optional(
    z.record(z.string().check(z.minLength(1)), z.number().check(z.int(), z.gte(1), z.lte(12))),
  ),
  /** Seasons a term is dated by, as the first and last month each covers: "Sommer 2019". */
  seasons: z.optional(
    z.record(
      z.string().check(z.minLength(1)),
      z.tuple([
        z.number().check(z.int(), z.gte(1), z.lte(12)),
        z.number().check(z.int(), z.gte(1), z.lte(12)),
      ]),
    ),
  ),
  /** Units of a role's printed duration: "4 Jahre 9 Monate". */
  durationUnits: optionalList("durationUnits"),
  /** Labels a name is written under: "Name: …". */
  nameLabels: optionalList("nameLabels"),
  /** Letters after a name ("Dipl.-Ing.", "CA" for a chartered accountant), and codes that name a
   * region rather than a credential ("MH", "KA"). */
  postNominals: optionalList("postNominals"),
  regionCodes: optionalList("regionCodes"),
  workplaceWords: optionalList("workplaceWords"),
  openEnded: optionalList("openEnded"),
  rangeWords: optionalList("rangeWords"),
  sinceWords: optionalList("sinceWords"),
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

const scriptName = z.string().check(
  z.superRefine((script, ctx) => {
    try {
      new RegExp(`\\p{Script=${script}}`, "u");
    } catch {
      ctx.addIssue({ code: "custom", message: `"${script}" is not a Unicode script name` });
    }
  }),
);

export const languagePackSchema = z
  .object({
    ...vocabularyShape,
    /** ISO 639-1 (or 639-3) code: "de", "hi". */
    id: z.string().check(z.regex(/^[a-z]{2,3}$/, "an ISO 639 language code")),
    name: z.string().check(z.minLength(1)),
    status,
    maintainers: z._default(z.array(z.string().check(z.minLength(1))), []),
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
  name: z.string().check(z.minLength(1)),
  status,
  maintainers: z._default(z.array(z.string().check(z.minLength(1))), []),
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
