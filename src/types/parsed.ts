/**
 * An education level on the ISCED 2011 scale (UNESCO): 2 lower secondary, 3 upper secondary,
 * 4 post-secondary non-tertiary, 5 short-cycle tertiary (associate), 6 bachelor's, 7 master's
 * (or a German Diplom), 8 doctoral.
 */
export type AtsIscedLevel = 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** A date as a resume states it: the month (1–12) is null when only the year is written. */
export type AtsParsedDate = { year: number; month: number | null };

/** One row of work history, in the shape an applicant tracking system stores it. */
export type AtsParsedRole = {
  title: string;
  employer: string;
  start: AtsParsedDate | null;
  end: AtsParsedDate | null;
  current: boolean;
};

/** One row of education: the school, the credential as written, and its ISCED level. */
export type AtsParsedEducation = {
  school: string;
  credential: string;
  isced: AtsIscedLevel | null;
  end: AtsParsedDate | null;
};

/** A level on the Common European Framework of Reference for Languages, A1 lowest. */
export type AtsCefrLevel = "A1" | "A2" | "B1" | "B2" | "C1" | "C2";

/** One certification or licence. `date` is when it was earned, `expires` when it lapses; null if unstated. */
export type AtsParsedCertification = {
  name: string;
  issuer: string;
  date: AtsParsedDate | null;
  expires: AtsParsedDate | null;
};

/**
 * One language the candidate speaks. `language` and `level` are as written ("Deutsch", "native";
 * `level` is empty when none); `cefr` is null when no level word the policy knows was given.
 */
export type AtsParsedLanguage = {
  language: string;
  level: string;
  cefr: AtsCefrLevel | null;
};

/** The groups of recovered fields that carry a provenance. */
export type AtsParsedField =
  | "name"
  | "email"
  | "phone"
  | "roles"
  | "education"
  | "skills"
  | "certifications"
  | "spokenLanguages";

/**
 * Where a recovered field came from, kept per field group:
 * - `parser` — read from the text by the deterministic parser: what an ATS would see.
 * - `structured` — taken from typed fields of an `AtsResumeDocument`; nothing was parsed.
 * - `ai` — recovered by a model after the parser missed it, and grounded against the text.
 * - `none` — not recovered.
 */
export type AtsProvenance = "parser" | "structured" | "ai" | "none";

/** What a parser recovers from the document: the fields a recruiter searches on. */
export type AtsParsedResume = {
  name: string;
  email: string;
  phone: string;
  links: string[];
  roles: AtsParsedRole[];
  education: AtsParsedEducation[];
  skills: string[];
  /** Certifications and licences, from their own section or a "Certifications:" line. */
  certifications: AtsParsedCertification[];
  /** Languages spoken, each once, from their own section or a "Languages:" line. Programming languages stay in `skills`. */
  spokenLanguages: AtsParsedLanguage[];
  /** Calendar months covered by at least one role, so overlapping jobs are not double counted. */
  monthsOfExperience: number | null;
  highestIsced: AtsIscedLevel | null;
  provenance: Record<AtsParsedField, AtsProvenance>;
};
