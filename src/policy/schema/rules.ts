import * as z from "zod/mini";

import { checkPatternWithFlags, regexFlags, regexString } from "../primitives.js";

const bandSchema = z.object({
  upTo: z.nullable(z.number()),
  weight: z.number().check(z.gte(0)),
  /** Evidence and fix for this band in place of the rule's own, for rules failing on both sides. */
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
   * A deduction rather than a quality measure: its weight is taken off the finished score in
   * points and left out of the denominator. For integrity rules such as hidden text.
   */
  penalty: z._default(z.boolean(), false),
  /**
   * The languages (ISO 639) the rule can judge. Dropped, neither passed nor failed, for a resume
   * read in any other. Without it the rule applies in every language.
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
     * What the pattern is tested against: `document` is the whitespace-collapsed resume, `line`
     * each line (for `^`/`$`), `heading` only lines shaped like section headings.
     */
    scope: z._default(z.enum(["document", "line", "heading"]), "document"),
    weight: z.number().check(z.gte(0)),
  })
  .check(z.superRefine(checkPatternWithFlags));

/** Whether the email address or phone number the parser recovered sits near the top. */
const positionRule = z.object({
  ...ruleBase.shape,
  kind: z.literal("position"),
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
     * What `metricsRatio` and `actionVerbRatio` look for; `actionVerbRatio` without one reads
     * `text.actionVerbs`.
     */
    pattern: z.optional(regexString("pattern")),
    flags: regexFlags,
    bands: bandsSchema,
  })
  .check(z.superRefine(checkPatternWithFlags));

/**
 * Scores a signal from the document's own geometry (columns, ruled tables). Only file uploads
 * carry geometry; for pasted text the rule is dropped, not passed or failed, and left out of the
 * score's denominator.
 */
const layoutRule = z.object({
  ...ruleBase.shape,
  kind: z.literal("layout"),
  /**
   * `imageCount`: images at least 80px a side. `hiddenTextChars`: characters drawn so a reader
   * cannot see them (see `AtsLayoutSignals`). `imageOnlyPages`: pages that are a picture with no
   * text layer.
   */
  metric: z.enum(["columnRatio", "tableCount", "imageCount", "hiddenTextChars", "imageOnlyPages"]),
  appliesWhen: z.literal("layout"),
  bands: bandsSchema,
});

/** Scores how much of the resume a parser recovered, via `parseResume`; a missed field is the finding. */
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
 * Whether the resume has a heading for a section, as the parser reads headings (the policy's
 * `resumeParse.sections` vocabulary, extended by language packs). Dropped from the score when
 * the text has no line structure.
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
