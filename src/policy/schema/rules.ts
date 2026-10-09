import * as z from "zod/mini";

import { checkPatternWithFlags, regexFlags, regexString } from "../primitives.js";

/** The rule kinds a policy scores with. */
const bandSchema = z.object({
  upTo: z.nullable(z.number()),
  weight: z.number().check(z.gte(0)),
  /**
   * What a result in this band says and how to fix it, in place of the rule's own. For a rule
   * that fails on both sides — too short and too long — whose advice points opposite ways.
   */
  failEvidence: z.optional(z.string().check(z.minLength(1))),
  fix: z.optional(z.string().check(z.minLength(1))),
});

const bandsSchema = z.array(bandSchema).check(
  z.minLength(1),
  z.superRefine((bands, ctx) => {
    let previous = -Infinity;
    bands.forEach((band, index) => {
      if (band.upTo === null) {
        if (index !== bands.length - 1)
          ctx.addIssue({
            code: "custom",
            path: [index, "upTo"],
            message: "Only the last band may have a null upper bound.",
          });
        return;
      }
      if (band.upTo <= previous)
        ctx.addIssue({
          code: "custom",
          path: [index, "upTo"],
          message: "Band upper bounds must be strictly ascending.",
        });
      previous = band.upTo;
    });
  }),
);

const ruleBase = z.object({
  id: z.string().check(z.minLength(1)),
  category: z.string().check(z.minLength(1)),
  severity: z.enum(["info", "warning", "error"]),
  passEvidence: z.string().check(z.minLength(1)),
  failEvidence: z.string().check(z.minLength(1)),
  fix: z.string().check(z.minLength(1)),
  /**
   * A deduction rather than a measure of quality: its weight is taken off the finished score in
   * points and it is left out of the denominator. For integrity rules — hidden text, a prompt
   * aimed at an AI screener — which say nothing about how good a resume is and must not, by
   * merely existing, shift the score of every honest one.
   */
  penalty: z._default(z.boolean(), false),
  /**
   * The languages (ISO 639) the rule can judge, for a rule that reads words of one language.
   * Dropped — neither passed nor failed — for a resume read in any other: see `text.language`
   * and the language packs. Without it a rule applies whatever the language.
   */
  languages: z.optional(
    z
      .array(z.string().check(z.regex(/^[a-z]{2,3}$/, "an ISO 639 language code")))
      .check(z.minLength(1)),
  ),
});

const minWordsRule = z.object({
  ...ruleBase.shape,
  kind: z.literal("min-words"),
  min: z.number().check(z.int(), z.gt(0)),
  weight: z.number().check(z.gte(0)),
});

const presenceRule = z
  .object({
    ...ruleBase.shape,
    kind: z.literal("presence"),
    pattern: regexString("pattern"),
    flags: regexFlags,
    invert: z._default(z.boolean(), false),
    /**
     * What the pattern is tested against. `document` (the default, and the historical behaviour)
     * is the whitespace-collapsed resume; `line` tests each line, which is what any pattern using
     * `^`/`$` actually needs; `heading` tests only lines shaped like section headings, so a rule
     * asking "is there an Experience section" cannot be satisfied by the word appearing in prose.
     */
    scope: z._default(z.enum(["document", "line", "heading"]), "document"),
    weight: z.number().check(z.gte(0)),
  })
  .check(z.superRefine(checkPatternWithFlags));

/**
 * Whether the contact details sit near the top. Without patterns it locates the email address
 * and phone number the parser recovered, which is the only way a phone number in any country's
 * format is found; the patterns remain for policies written before that.
 */
const positionRule = z.object({
  ...ruleBase.shape,
  kind: z.literal("position"),
  emailPattern: z.optional(regexString("emailPattern")),
  phonePattern: z.optional(regexString("phonePattern")),
  windowFraction: z.number().check(z.gte(0), z.lte(1)),
  weight: z.number().check(z.gte(0)),
});

const bandsRule = z
  .object({
    ...ruleBase.shape,
    kind: z.literal("bands"),
    metric: z.enum([
      "wordCount",
      "metricsRatio",
      "actionVerbRatio",
      "buzzwordCount",
      /** Lines extracted one glyph per word, as tracked headings do. See `despaceLines`. */
      "letterSpacedLines",
      /** Integrity: instructions addressed to an AI screener (`text.injectionPhrases`). */
      "injectionPhrases",
      /** Integrity: zero-width, tag and bidirectional-control characters. */
      "invisibleCharacters",
      /** Integrity: words mixing Latin and Cyrillic letters. */
      "homoglyphWords",
      /** Integrity: share of the posting present word for word. Needs a job description. */
      "copiedPostingRatio",
      /** Integrity: terms or lines repeated far beyond what text needs. */
      "stuffedTerms",
      /** Dates that cannot all be true: future starts, crowded overlaps, an overlong career. */
      "timelineIssues",
      /** Share of listed skills (three or more) that no other section mentions. */
      "unsupportedSkills",
      /** Writing: bullets in the first person (`writing.firstPersonPronouns`). */
      "firstPersonLines",
      /** Writing: share of bullets with an auxiliary before a participle ("was built"). */
      "passiveVoiceRatio",
      /** Writing: bullets opening with a duty (`writing.weakOpeners`). */
      "weakOpeners",
      /** Writing: bullets whose first verb's tense does not fit the role (current or past). */
      "tenseMismatches",
      /** Writing: bullets longer than `writing.maxBulletWords`. */
      "longBullets",
      /** Writing: roles with bullets outside `writing.bulletsPerRole`. */
      "bulletsPerRole",
      /** Writing: runs of `writing.repeatedOpenerRun` bullets opening with the same word. */
      "repeatedOpeners",
      /** Writing: how many formats the roles' dates are written in ("Jan 2020", "03/2021"). */
      "dateFormats",
    ]),
    /**
     * What `metricsRatio` and `actionVerbRatio` look for. An `actionVerbRatio` rule without one
     * reads `text.actionVerbs`, which language packs extend.
     */
    pattern: z.optional(regexString("pattern")),
    flags: regexFlags,
    bands: bandsSchema,
  })
  .check(z.superRefine(checkPatternWithFlags));

/**
 * Scores a signal recovered from the document's own geometry rather than from its text —
 * whether the page is laid out in columns, whether it contains ruled table grids. These are the
 * failures that text alone cannot see: a two-column resume extracts as perfectly ordinary words
 * in a ruinous order, and nothing in the character stream gives that away.
 *
 * Only file uploads carry geometry. When a resume arrives as pasted text or a Studio document
 * there is nothing to measure, so the rule is dropped from the report entirely — neither passed
 * nor failed, and excluded from the score's denominator. Scoring an unmeasurable signal in
 * either direction would be a guess presented as a check.
 */
const layoutRule = z.object({
  ...ruleBase.shape,
  kind: z.literal("layout"),
  /** `imageCount` is images at least 80px a side, so icons are not counted and a photo is. */
  /**
   * `hiddenTextChars`: characters drawn so a reader cannot see them (see `AtsLayoutSignals`).
   * `imageOnlyPages`: pages that are a picture with no text layer.
   */
  metric: z.enum(["columnRatio", "tableCount", "imageCount", "hiddenTextChars", "imageOnlyPages"]),
  appliesWhen: z.literal("layout"),
  bands: bandsSchema,
});

/**
 * Scores how much of the resume a parser could actually recover.
 *
 * Distinct from every other rule kind because it grades the *document as data* rather than the
 * document as prose. An applicant tracking system does not rank a resume; it shreds it into a
 * row per job holding an employer, a title and a date range, and lets recruiters filter those
 * rows. A resume whose history cannot be recovered arrives with empty columns — invisible to the
 * filter no matter how well it reads. These metrics come from `parseResume`, and its failure to
 * find a field is the finding.
 */
const parsedRule = z.object({
  ...ruleBase.shape,
  kind: z.literal("parsed"),
  metric: z.enum([
    "rolesDetected",
    "roleCompleteness",
    "datedRoleRatio",
    "contactCompleteness",
    "educationDetected",
    /** 1 when the resume states a date of birth (`resumeParse.dateOfBirthLabels`), else 0. */
    "dateOfBirthStated",
  ]),
  bands: bandsSchema,
});

/**
 * Whether the resume has a heading for a section, as the parser reads headings: the policy's
 * `resumeParse.sections` vocabulary and the same shape rules the parser segments by.
 *
 * Preferred over a `presence` rule on `heading` scope, whose pattern was a second copy of the
 * section vocabulary: the two drifted, so the report could say "no Experience heading" about a
 * resume whose roles were parsed from under one — and a language pack extends the vocabulary,
 * which only this kind sees. Dropped from the score when the text has no line structure.
 */
const sectionRule = z.object({
  ...ruleBase.shape,
  kind: z.literal("section"),
  section: z.enum(["experience", "education", "skills", "projects"]),
  weight: z.number().check(z.gte(0)),
});

export const ruleSchema = z.discriminatedUnion("kind", [
  minWordsRule,
  presenceRule,
  positionRule,
  bandsRule,
  layoutRule,
  parsedRule,
  sectionRule,
]);
