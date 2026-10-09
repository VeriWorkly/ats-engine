import { z } from "zod";

import {
  cefrLevels,
  credentialWords,
  iscedDegrees,
  regexString,
  wordList,
  type IscedDegrees,
} from "../primitives.js";

/**
 * Vocabulary the resume parser needs. Data, so it lives in the policy alongside the rules rather
 * than in the source — a new job-title word or degree spelling should not require a deploy.
 */
export const resumeParseSchema = z.object({
  sections: z.object({
    experience: regexString("sections.experience"),
    education: regexString("sections.education"),
    skills: regexString("sections.skills"),
    projects: regexString("sections.projects"),
    /**
     * Certifications and licences, each line read as a row: name, issuer, dates. Tried before
     * `other`, so a policy whose `other` still names them reads them here; "Education and
     * Certifications" stays education, which is tried first.
     */
    certifications: regexString("sections.certifications").default(
      String.raw`^(?:(?:professional\s+)?certifications?|certificates|licen[cs]es?|licensure|credentials)`,
    ),
    /**
     * Spoken languages, each read as a row with its level. Not "Programming Languages", and a
     * "Languages: Go, Rust" line among the skills stays a skills line.
     */
    languages: regexString("sections.languages").default(
      String.raw`^(?:(?:spoken|foreign)\s+)?languages|^language\s+(?:skills|proficienc(?:y|ies)|competenc(?:y|ies))`,
    ),
    /** Any other heading. Classified only so that it terminates the block above it. */
    other: regexString("sections.other"),
  }),
  /**
   * The words that state how well a language is spoken — whole words or small patterns, matched
   * ignoring case — and the CEFR level each stands for. An explicit level ("B2") needs no entry
   * and wins over a word beside it. "Fluent" is C1; "native" C2, as the ILR scale's native or
   * bilingual proficiency; "professional working proficiency" (ILR 3) C1. "Bilingual" alone is
   * C1: a posting asking for "bilingual English/Spanish" is met by fluent Spanish. The same words
   * read a posting's ask, so "fluent German" asks for C1. Packs add their own.
   */
  languageLevels: cefrLevels("languageLevels").default({
    [String.raw`native\s+or\s+bilingual(?:\s+proficiency)?`]: "C2",
    [String.raw`full\s+professional(?:\s+proficiency)?`]: "C2",
    [String.raw`native(?:\s+speaker)?`]: "C2",
    [String.raw`mother\s+tongue`]: "C2",
    [String.raw`first\s+language`]: "C2",
    bilingual: "C1",
    [String.raw`professional\s+working(?:\s+proficiency)?`]: "C1",
    professional: "C1",
    fluent: "C1",
    fluency: "C1",
    proficient: "C1",
    advanced: "C1",
    [String.raw`business\s+fluent`]: "C1",
    [String.raw`business[\s-]level`]: "B2",
    [String.raw`upper[\s-]intermediate`]: "B2",
    [String.raw`limited\s+working(?:\s+proficiency)?`]: "B1",
    [String.raw`working\s+knowledge`]: "B1",
    conversational: "B1",
    intermediate: "B1",
    [String.raw`elementary(?:\s+proficiency)?`]: "A2",
    basic: "A2",
    beginner: "A1",
  }),
  /**
   * The words around a certification's dates and issuer: "Issued Mar 2022", "expires 2027",
   * "from Google Cloud", "Credential ID 9X7Y". A date after an `expires` word is the expiry; a
   * part opening with an `id` word is dropped.
   */
  credentialWords: credentialWords.prefault({}),
  /**
   * Month name -> month number, for the date spellings a resume actually uses.
   *
   * Language-bound, so it belongs in the policy rather than in the parser. It was previously a
   * constant in source, which would have made a second locale a rewrite of the date scanner
   * instead of another policy file. Optional, and defaulted to English.
   *
   * Each key is a whole word, matched with an optional full stop: list every spelling to read,
   * "jan" and "january" alike. (An abbreviation used to stretch to any longer word, which read
   * "Novartis 2018" as November.)
   */
  months: z.record(z.string(), z.number().int().min(1).max(12)).default({
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  }),
  /**
   * Seasons a resume dates a term by — "Spring 2020 - Fall 2021", "Summer 2018" — as the first
   * and last month each covers. A range starts at its first season's first month and ends at its
   * last season's last month; a season standing alone is a term of its own.
   */
  seasons: z
    .record(
      z.string().min(1),
      z.tuple([z.number().int().min(1).max(12), z.number().int().min(1).max(12)]),
    )
    .default({
      spring: [3, 5],
      summer: [6, 8],
      fall: [9, 11],
      autumn: [9, 11],
      winter: [1, 3],
    }),
  /** The ways a resume says a role is still current. Language-bound, hence data. */
  openEnded: z
    .array(z.string().min(1))
    .min(1)
    .default(["present", "current", "now", "ongoing", "to date", "till date", "today"]),
  /**
   * Units of a length of time written beside a date range, which LinkedIn exports print:
   * "Jan 2020 - Present · 4 yrs 9 mos", "(4 years 9 months)". A number before one of these is
   * the role's duration, not its title or employer.
   */
  durationUnits: wordList("durationUnits").default([
    "yr",
    "yrs",
    "year",
    "years",
    "mo",
    "mos",
    "month",
    "months",
  ]),
  /** Labels a resume writes its owner's name under: "Name: Jane Doe". */
  nameLabels: wordList("nameLabels").default(["name", "full name"]),
  /** Words between the two ends of a date range besides a dash: "2019 to 2022", "2019 bis 2022". */
  rangeWords: wordList("rangeWords").default(["to", "until", "through"]),
  /** Words before a lone start date that make it a current role: "since 2019", "seit 03/2019". */
  sinceWords: wordList("sinceWords").default(["since"]),
  /** Words joining a job title to its employer on one line: "Engineer at Acme". */
  employerWords: wordList("employerWords").default(["at"]),
  /**
   * What the top of a resume says in place of a name. Never taken as the candidate's name,
   * which matters now that a single word can be one.
   */
  documentTitles: wordList("documentTitles").default([
    "resume",
    "résumé",
    "curriculum vitae",
    "cv",
  ]),
  /**
   * Lowercase words a name may hold between its capitalised ones: "Ludwig van Beethoven",
   * "María de la Cruz", "Ahmad bin Ismail". One list for every language, because names travel.
   */
  nameParticles: wordList("nameParticles").default([
    "van",
    "von",
    "der",
    "den",
    "de",
    "del",
    "della",
    "la",
    "le",
    "da",
    "di",
    "du",
    "dos",
    "das",
    "y",
    "ter",
    "ten",
    "bin",
    "binti",
    "ibn",
    "al",
    "el",
  ]),
  /**
   * Credentials written after a name ("Priya Raman, MBA", "Jane Doe, MD"): a name cut from one of
   * these is the name, wherever a company over a title sits below it. Matched whole, ignoring case.
   */
  postNominals: wordList("postNominals").default([
    String.raw`ph\.?d\.?`,
    String.raw`m\.?d\.?`,
    String.raw`d\.?o\.?`,
    String.raw`j\.?d\.?`,
    String.raw`esq\.?`,
    "mba",
    "msc",
    "bsc",
    "cpa",
    "cfa",
    "cma",
    "acca",
    "pmp",
    "cissp",
    "csm",
    String.raw`p\.?e\.?`,
    String.raw`r\.?n\.?`,
    "bsn",
    "msn",
    "np",
    "rd",
    "dds",
    "dmd",
    "dvm",
    "pharmd",
    "lcsw",
    "frcs",
    "mrcp",
  ]),
  /**
   * Two-letter codes of states and provinces, written in capitals after a city ("New York, NY").
   * A name cut from one of these is a place, unless the code is also a credential the
   * `postNominals` list ("MD"). Matched whole and case-sensitively.
   */
  regionCodes: wordList("regionCodes").default(
    (
      "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ " +
      "NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY " +
      "AB BC MB NB NL NS NT NU ON PE QC SK YT"
    ).split(" "),
  ),
  /** Words that say how or where a role is worked rather than for whom: "Remote", "Hybrid". */
  workplaceWords: wordList("workplaceWords").default([
    "remote",
    "hybrid",
    "on-?site",
    "in-office",
    "work from home",
    "wfh",
  ]),
  /**
   * Lowercase words a capitalised heading may join its words with: "Skills and Tools". Any other
   * lowercase word after the heading word reads as prose ("History of Art BA").
   */
  headingConnectors: wordList("headingConnectors").default(["and"]),
  /** Labels a resume states a date of birth under: "Date of birth: 4 May 1990". */
  dateOfBirthLabels: wordList("dateOfBirthLabels").default([
    "date of birth",
    String.raw`d\.o\.b\.?`,
    "dob",
    "born",
  ]),
  /**
   * How an all-numeric date with a day is ordered — "03/04/2021" is 4 March in the US and 3 April
   * in Germany and India. Only the month matters to tenure, so a wrong guess costs at most a
   * month or two; a part over 12 settles it either way. Set by a region pack.
   */
  dateOrder: z.enum(["MDY", "DMY", "YMD"]).default("MDY"),
  /**
   * ISO 3166 countries a phone number without a country code is tried as, in order. A number
   * with one ("+49 30 1234567") is read as what it says. Set by a region pack.
   */
  phoneRegions: z
    .array(z.string().regex(/^[A-Z]{2}$/, "a two-letter ISO 3166 country code"))
    .min(1)
    .default(["US"]),
  /** Words that mark a fragment as a job title rather than an employer name. */
  titleWords: wordList("titleWords"),
  /** Words that mark a fragment as an institution. */
  schoolWords: wordList("schoolWords"),
  /**
   * One pattern per ISCED 2011 level (see `AtsIscedLevel`), naming the credentials at it. Levels
   * are tried highest first, so a line naming two credentials is recorded at the higher one —
   * which is why a level's pattern must not also match a credential of a lower one ("high school
   * diploma" is level 3, not the diploma of level 4). A policy written before ISCED, keyed
   * diploma/associate/bachelor/master/doctorate, is still read: as levels 4, 5, 6, 7 and 8.
   */
  degrees: z
    .union([
      z
        .object({
          diploma: regexString("degrees.diploma"),
          associate: regexString("degrees.associate"),
          bachelor: regexString("degrees.bachelor"),
          master: regexString("degrees.master"),
          doctorate: regexString("degrees.doctorate"),
        })
        .transform((legacy): IscedDegrees => ({
          "4": legacy.diploma,
          "5": legacy.associate,
          "6": legacy.bachelor,
          "7": legacy.master,
          "8": legacy.doctorate,
        })),
      iscedDegrees,
    ])
    .refine((degrees) => Object.values(degrees).some(Boolean), {
      message: "degrees must name at least one level",
    }),
});
