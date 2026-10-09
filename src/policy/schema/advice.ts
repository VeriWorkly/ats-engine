import * as z from "zod/mini";

import { regexString, wordList } from "../primitives.js";

/**
 * What the advice reads and says (`advice/`): notes that are not scored — about the file, about
 * details that can invite age bias, about a target ATS the caller named. Never a rule: nothing
 * here moves a score.
 *
 * English text and word lists, as every report string is; `prefault` so a policy written before
 * this section existed still parses, with these defaults.
 */

/** A message, what was found (quoted into `evidence`) and what to do, as templates. */
const text = (message: string, evidence: string | undefined, fix: string) =>
  z._default(
    z.object({
      message: z.string().check(z.minLength(1)),
      evidence: z.optional(z.string().check(z.minLength(1))),
      fix: z.string().check(z.minLength(1)),
    }),
    evidence === undefined ? { message, fix } : { message, evidence, fix },
  );

/**
 * One documented behaviour of a vendor's ATS. `source` is the vendor's own public page that says
 * so: a note nobody can check is not one to give.
 */
const atsNote = z.object({
  id: z.string().check(z.regex(/^[A-Za-z][\w-]*$/, "a note id: letters, digits, '-' or '_'")),
  message: z.string().check(z.minLength(1)),
  source: z.string().check(z.regex(/^https:\/\/\S+$/, "an https URL")),
});

const atsTarget = z.object({
  name: z.string().check(z.minLength(1)),
  notes: z.array(atsNote).check(z.minLength(1)),
});

const GREENHOUSE_PARSE =
  "https://support.greenhouse.io/hc/en-us/articles/200989175-Unsuccessful-resume-parse";

/**
 * Only what the vendor documents on a public page, checked on the day it was written (October
 * 2026). Workday and iCIMS are left out: neither publishes candidate-facing limits that could be
 * checked; employers configure their own.
 */
const DEFAULT_TARGETS: Record<string, z.input<typeof atsTarget>> = {
  greenhouse: {
    name: "Greenhouse",
    notes: [
      {
        id: "parseSize",
        message:
          "Greenhouse documents that it cannot parse a resume larger than 2.5 MB: the file is only attached, and its details are left to be typed in by hand.",
        source: GREENHOUSE_PARSE,
      },
      {
        id: "layout",
        message:
          "Greenhouse lists columns, tables, headers and footers, graphics, and a name or contact details in a header, footer or text box among the causes of a failed or partial parse.",
        source: GREENHOUSE_PARSE,
      },
      {
        id: "fileTypes",
        message: "Greenhouse accepts resumes as .pdf, .doc, .docx, .rtf or .txt.",
        source:
          "https://support.greenhouse.io/hc/en-us/articles/360052218132-Supported-file-types-for-resumes-and-cover-letters",
      },
    ],
  },
  lever: {
    name: "Lever",
    notes: [
      {
        id: "images",
        message:
          "Lever documents that it cannot parse a resume saved as an image (JPG, PNG), and suggests a test: if you cannot select the text in the file, it is likely not parseable.",
        source:
          "https://help.lever.co/hc/en-us/articles/20087345054749-Understanding-Resume-Parsing",
      },
    ],
  },
  taleo: {
    name: "Oracle Taleo",
    notes: [
      {
        id: "fileTypes",
        message:
          "In Oracle Taleo each employer's administrators choose which file formats candidates may attach, so use one the careers site offers; PDF, Word (.doc, .docx), RTF, HTML and plain text are among those Taleo supports.",
        source:
          "https://docs.oracle.com/en/cloud/saas/taleo-enterprise/22d/otrcg/c-attachment.html",
      },
    ],
  },
};

export const adviceSchema = z.prefault(
  z.object({
    file: z.prefault(
      z.object({
        /**
         * Words that say nothing about whose resume a file is. A name made of these alone (and
         * digits) is flagged: "resume.pdf", "CV.docx", "Document1.docx", "scan0001.pdf". Matched
         * as whole words, with `_`, `-` and `.` read as spaces.
         */
        genericNames: z._default(wordList("advice.file.genericNames"), [
          "resume",
          "résumé",
          "resumé",
          "cv",
          String.raw`curriculum\s*vitae`,
          String.raw`cover\s*letter`,
          "my",
          "the",
          "and",
          String.raw`document\d*`,
          String.raw`doc\d*`,
          String.raw`untitled\d*`,
          String.raw`scan\d*`,
          "scanned",
          String.raw`img\d*`,
          String.raw`image\d*`,
          String.raw`file\d*`,
          String.raw`page\d*`,
        ]),
        /** Marks of a draft or a duplicate, flagged wherever they stand in the name. */
        draftMarks: z._default(wordList("advice.file.draftMarks"), [
          "final",
          "draft",
          "copy",
          String.raw`v\d{1,3}`,
          String.raw`ver\d{1,3}`,
          String.raw`version\s?\d{1,3}`,
          String.raw`rev\d{0,3}`,
          "revised",
          "updated",
          "latest",
          "new",
          "old",
          "edited",
          String.raw`\(\d{1,3}\)`,
        ]),
        /** The name suggested instead; `{name}` is the candidate's, `{ext}` the extension. */
        suggestedName: z._default(z.string().check(z.minLength(1)), "{name}-Resume{ext}"),
        /** `{name}` when the parser read none. */
        placeholderName: z._default(z.string().check(z.minLength(1)), "Firstname-Lastname"),
        /** Over this many bytes the size is advised on: a common upload limit, not a universal one. */
        maxBytes: z._default(z.number().check(z.int(), z.gt(0)), 2 * 1024 * 1024),
      }),
      {},
    ),
    age: z.prefault(
      z.object({
        /**
         * A graduation year more than this many years before the reference date is advised on.
         * Unset (the default) turns the advice off; a region pack sets it (`ageAdvice`).
         */
        graduationYears: z.optional(z.number().check(z.int(), z.gt(0))),
        /** More than this many years of experience, stated or dated, is advised on. Unset: off. */
        experienceYears: z.optional(z.number().check(z.int(), z.gt(0))),
        /**
         * A stated total: "30+ years of experience". The first capture group is the number of
         * years. Bounded repetition only: these run over the whole resume.
         */
        experiencePatterns: z._default(z.array(regexString("advice.age.experiencePatterns")), [
          String.raw`(?<!\p{N})(\d{1,2})\s?\+?\s?(?:years?|yrs\.?)['’]?\s(?:of\s)?(?:[\p{L}-]{1,30}\s){0,2}?experience`,
        ]),
      }),
      {},
    ),
    /** Notes per target ATS, by the id a caller names (`targetAts`, `--ats`). */
    targets: z._default(
      z.record(z.string().check(z.regex(/^[a-z][a-z0-9-]*$/, "a lower-case id")), atsTarget),
      DEFAULT_TARGETS as Record<string, z.output<typeof atsTarget>>,
    ),
    messages: z.prefault(
      z.object({
        fileName: text(
          "The file name does not say whose resume it is, or reads as a draft. Recruiters see it in the ATS and in their downloads, beside everyone else's.",
          'The file is named "{name}".',
          "Name it {suggestion}.",
        ),
        /** For a name with draft marks: `{marks}` lists them, quoted. */
        fileNameDraft: z._default(
          z.string().check(z.minLength(1)),
          'The file is named "{name}", which reads as a draft: {marks}.',
        ),
        fileSize: text(
          "The file is larger than {limit}. Many ATS upload forms and parsers stop at about that size; it is a common limit, not a universal one.",
          "The file is {size}.",
          "Shrink or remove the images and export again; a resume of text alone is well under {limit}.",
        ),
        passwordProtected: text(
          "The file is password-protected or encrypted. An ATS that cannot open it reads nothing, and some refuse an encrypted file even when it opens without a password.",
          undefined,
          "Save a copy with no password or security settings, and upload that.",
        ),
        trackedChanges: text(
          "The document still holds tracked changes. A recruiter who opens it in Word sees the edits, and a parser may read deleted text as if it were there.",
          "{n} tracked {n|change|changes} in the document.",
          "In Word, accept or reject every change (Review, Accept All Changes), turn Track Changes off, and save again.",
        ),
        comments: text(
          "The document still holds comments. A recruiter who opens it in Word sees them.",
          "{n} {n|comment|comments} in the document.",
          "In Word, delete them (Review, Delete All Comments in Document) and save again.",
        ),
        graduationYear: text(
          "A graduation year more than {years} years back lets a reader work out your age, which can invite age bias. Leaving off graduation years older than about 15 years is common advice; the degree and the school are what a screen checks.",
          "Education dated {dates}.",
          "Keep the degree and the school, and leave the year off.",
        ),
        experienceYears: text(
          "More than {years} years of experience, stated or dated in full, lets a reader work out your age, which can invite age bias.",
          'The resume says "{phrase}".',
          'Show the last 15 years or so in detail, sum up earlier roles in a line without dates, and write "15+ years" rather than the full count.',
        ),
        /** For a total read from the dated roles rather than stated. */
        experienceHistory: z._default(
          z.string().check(z.minLength(1)),
          "{n} years of work history are dated.",
        ),
      }),
      {},
    ),
  }),
  {},
);
