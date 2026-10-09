/**
 * The public report types. The parsed record and the layout signals have files of their own
 * under `./types/`, re-exported here so every import of `types.js` keeps working.
 */
import type { AtsParsedResume } from "./types/parsed.js";

export type * from "./types/layout.js";
export type * from "./types/parsed.js";

export type AtsSeverity = "info" | "warning" | "error";

export type AtsRuleResult = {
  id: string;
  category: string;
  severity: AtsSeverity;
  passed: boolean;
  evidence: string;
  scoreImpact: number;
  fix: string;
};

/**
 * Per-category rollup of the deterministic rules. `lost` is the sum of the score impacts the
 * category actually cost, `possible` the worst case it could have cost, so `score` is the
 * percentage of that category the resume kept. Exposing the rollup is deliberately safe: it is
 * an aggregate of numbers the full report already returns per rule, and it tells an anonymous
 * caller *where* the problem is without handing over the rule-by-rule answer key.
 */
export type AtsCategoryScore = {
  category: string;
  score: number;
  passed: number;
  total: number;
  lost: number;
  possible: number;
};

/**
 * One requirement of the posting, judged against the resume, the way a per-qualification
 * screener grades it (Workday HiredScore, Ashby): met or not, with the resume's own words as
 * evidence. `unverifiable`: not something a resume settles — the right to work, a clearance —
 * unless it says so; such a question is asked in the application, and often filters there.
 */
export type AtsRequirement = {
  /** The requirement as the posting wrote it. */
  text: string;
  importance: "required" | "preferred";
  kind: "skills" | "experience" | "education" | "authorization" | "clearance" | "language";
  status: "met" | "partial" | "missing" | "unverifiable";
  /** What the requirement names, and whether the resume has each. Skills and languages. */
  terms: Array<{ term: string; found: boolean }>;
  /** Resume lines that show it, quoted. Work history first; a skills list last. */
  evidence: string[];
  /** For years and degrees: what was compared, "6 years in the work history, 5 asked". */
  detail?: string;
};

/** Posting terms by kind: hard skills and every other word, then soft skills. */
export type AtsKeywordGroups = { hard: string[]; soft: string[] };

/**
 * Something worth knowing that is not scored: about the file (its name, size, a password, tracked
 * changes left in), about details that can invite age bias where the region pack says so, and
 * about a target ATS the caller named. Never part of the readiness score, the categories, the
 * failed checks or the fixes. The text comes from the policy (`advice`).
 */
export type AtsAdvice = {
  /** "file.name", "age.graduationYear", "ats.greenhouse.parseSize", … */
  id: string;
  kind: "file" | "age" | "ats";
  message: string;
  /** What was found, quoted: the file name, a year, a phrase. Absent when there is nothing to quote. */
  evidence?: string;
  fix?: string;
  /** For an `ats` note: the vendor's public page that documents it. */
  source?: string;
};

/**
 * What the caller knows about the uploaded file, for the file advice. Every field is optional;
 * advice needing one that is absent is not given. Pasted text has no file: pass nothing.
 */
export type AtsFileInfo = {
  /** The file's name as uploaded, with its extension: "Resume_final_v3 (2).pdf". */
  name?: string;
  bytes?: number;
  format?: "pdf" | "docx" | "html" | "text";
  /** The file needs a password to open, or carries one restricting it. */
  passwordProtected?: boolean;
  /** A Word document still holding tracked changes, or comments. */
  trackedChanges?: boolean;
  comments?: boolean;
};

export type AtsReport = {
  /** The scoring policy's declared `version` ("ats-v2" for the community policy). */
  version: string;
  readinessScore: number;
  jobMatchScore: number | null;
  /**
   * Posting terms the resume has and lacks, hard skills (and every other word) first, then soft
   * skills; at most 12. The two groups joined, cut to 12.
   */
  matchedKeywords: string[];
  missingKeywords: string[];
  /**
   * The same terms by kind, each group at most 12. `soft` holds the policy's soft skills
   * (`keywordMatch.softSkills`: "communication", "teamwork"), which weigh less in
   * `jobMatchScore` (`keywordMatch.softSkillWeight`); `hard` holds everything else.
   */
  matchedKeywordGroups: AtsKeywordGroups;
  missingKeywordGroups: AtsKeywordGroups;
  /**
   * Evidence of every failed check that stops an ATS reading the document: the parse checks, and
   * the format checks on how the text extracts (columns, tables, letter spacing).
   */
  parsingWarnings: string[];
  strengths: string[];
  failedChecks: AtsRuleResult[];
  prioritizedFixes: string[];
  rules: AtsRuleResult[];
  categories: AtsCategoryScore[];
  checksPassed: number;
  checksTotal: number;
  wordCount: number;
  /** The fields an ATS would recover from this document. See AtsParsedResume. */
  parsed: AtsParsedResume;
  /**
   * The locale packs the resume was read with: languages detected (or asked for) beyond the
   * policy's base vocabulary, and the region applied. Empty and null without packs attached.
   */
  locale: { languages: string[]; region: string | null };
  /**
   * What produced this report: the engine's version and a fingerprint of the policy as applied.
   * The same input, reference date (`now`), engine and policy fingerprint always give the same
   * report; a score that moved with neither changed was not this engine's doing.
   */
  engine: { version: string; policy: string };
  /** The posting's requirements, each judged; empty without a job description. At most 25. */
  requirements: AtsRequirement[];
  /**
   * Advice that is not scored: file hygiene when the caller described the file, age signals where
   * the region pack asks for them, a named target ATS's documented notes. Always present; empty
   * when there is nothing to say. Changes no score.
   */
  advice: AtsAdvice[];
  /**
   * The text in the order the engine read it — after wrapped lines were rejoined and spaced
   * letters read back — when `includeLines` was asked for. At most 500 lines.
   */
  lines?: string[];
};
