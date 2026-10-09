/**
 * A resume as structured data — the input for callers that already hold typed fields.
 *
 * Text input has to be parsed, and parsing is lossy by nature: that loss is what the engine
 * reports on. A caller holding the resume as data (an editor, a profile store, a JSON Resume
 * file) has nothing to lose, so it sends this instead. The recovered record is then taken from
 * the fields directly (provenance `structured`), and the content rules run on a canonical text
 * rendering with real section headings.
 *
 * `format` is the discriminator. Any object without it is treated as an arbitrary document and
 * flattened, which is the legacy behaviour.
 *
 * Dates are `YYYY-MM` or `YYYY`. Other spellings are accepted if the policy's date vocabulary
 * can read them, but the ISO forms are the contract.
 */

/** The `format` an `AtsResumeDocument` declares, and the version of its shape. */
export const ATS_DOCUMENT_FORMAT = "ats-resume@1";

/**
 * Size limits for a document. Arrays past these are rejected; strings past theirs are cut.
 * Set at or above what the Studio editor itself allows, so a resume a user can build is never
 * refused for its size.
 */
export const DOCUMENT_LIMITS = {
  sections: 40,
  items: 200,
  lines: 100,
  keywords: 200,
  links: 50,
  field: 500,
  line: 5_000,
  text: 10_000,
} as const;

/** A role in an `experience` section. Dates are `YYYY-MM` or `YYYY`. */
export type AtsDocumentRole = {
  title: string;
  employer: string;
  location?: string;
  start?: string;
  end?: string;
  current?: boolean;
  summary?: string;
  highlights?: string[];
};

/** A row of an `education` section. `credential` is the degree as written ("B.Sc."). */
export type AtsDocumentEducation = {
  school: string;
  credential?: string;
  field?: string;
  start?: string;
  end?: string;
  current?: boolean;
  summary?: string;
};

/** A row of a `projects` section. */
export type AtsDocumentProject = {
  name: string;
  role?: string;
  url?: string;
  summary?: string;
  highlights?: string[];
  skills?: string[];
};

/** A group of a `skills` section: its keywords, under an optional name ("Languages"). */
export type AtsDocumentSkillGroup = {
  name?: string;
  keywords: string[];
};

/** A certification or licence. `date` when it was earned, `expires` when it lapses. */
export type AtsDocumentCertification = {
  name: string;
  issuer?: string;
  date?: string;
  expires?: string;
  url?: string;
};

/**
 * A language spoken. `level` as the resume states it: a word ("Native", "fließend") or a CEFR
 * level ("B2"); the engine reads its CEFR level from either.
 */
export type AtsDocumentLanguage = {
  language: string;
  level?: string;
};

/** A row in any section without a dedicated shape: awards, publications, interests, … */
export type AtsDocumentEntry = {
  heading?: string;
  lines?: string[];
};

/**
 * `title` is the heading as printed on the page, in whatever language the resume is in. The
 * structure rules read it, so it should be what the reader actually sees.
 */
export type AtsDocumentSection =
  | { kind: "summary"; title: string; text: string }
  | { kind: "experience"; title: string; items: AtsDocumentRole[] }
  | { kind: "education"; title: string; items: AtsDocumentEducation[] }
  | { kind: "projects"; title: string; items: AtsDocumentProject[] }
  | { kind: "skills"; title: string; items: AtsDocumentSkillGroup[] }
  | { kind: "certifications"; title: string; items: AtsDocumentCertification[] }
  | { kind: "languages"; title: string; items: AtsDocumentLanguage[] }
  | { kind: "other"; title: string; items: AtsDocumentEntry[] };

/** The header of the resume: the name and the contact details. */
export type AtsDocumentBasics = {
  name: string;
  headline?: string;
  email?: string;
  phone?: string;
  location?: string;
  links?: string[];
};

/**
 * A resume as structured data (`format: "ats-resume@1"`). The engine reads its fields directly
 * (provenance `structured`) and scores a rendering of it with real section headings.
 */
export type AtsResumeDocument = {
  format: typeof ATS_DOCUMENT_FORMAT;
  basics: AtsDocumentBasics;
  /** In page order. Hidden sections are left out by the caller, not flagged. */
  sections: AtsDocumentSection[];
};

/** A cheap structural test for the discriminator. Validation happens when the engine reads it. */
export function isResumeDocument(value: unknown): value is AtsResumeDocument {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { format?: unknown }).format === ATS_DOCUMENT_FORMAT
  );
}
