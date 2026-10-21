import type { AtsParsedResume } from "./types/parsed.js";

export type * from "./types/layout.js";
export type * from "./types/parsed.js";

/** How much a failed rule matters to an ATS, as the rubric states it. */
export type AtsSeverity = "info" | "warning" | "error";

/** One rule as it applied to this resume: whether it passed, what was found, and what to do. */
export type AtsRuleResult = {
  /** The rule's id in the policy: "ats-v2.writing.tense". */
  id: string;
  /**
   * In the community policy "parse", "contact", "structure", "content", "format", "writing" or
   * "integrity".
   */
  category: string;
  severity: AtsSeverity;
  passed: boolean;
  /** What was found, quoted where it can be: "1 bullet speaks in the first person, such as …". */
  evidence: string;
  /** The weight the rule cost here (for an integrity rule, the points deducted); 0 when passed. */
  scoreImpact: number;
  fix: string;
};

/**
 * Per-category rollup of the rules. `lost` is the score impact the category cost, `possible` the
 * worst case, so `score` is the percentage the resume kept. Safe to expose: it says where the
 * problem is without the rule-by-rule answer key.
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
 * One requirement of the posting, judged against the resume: met or not, with the resume's own
 * words as evidence. `unverifiable`: not settled by a resume unless it says so (right to work,
 * a clearance); the application asks it.
 */
export type AtsRequirement = {
  /** The requirement as the posting wrote it. */
  text: string;
  importance: "required" | "preferred";
  /** `seniority`: the level the posting's title names ("Senior …"), first when there is one. */
  kind:
    | "skills"
    | "experience"
    | "education"
    | "authorization"
    | "clearance"
    | "language"
    | "seniority";
  status: "met" | "partial" | "missing" | "unverifiable";
  /** What the requirement names, and whether the resume has each. Skills and languages. */
  terms: Array<{ term: string; found: boolean }>;
  /** Resume lines that show it, quoted. Work history first; a skills list last. */
  evidence: string[];
  /** For years, degrees, language levels and clearances, what was compared: "6 years, 5 asked". */
  detail?: string;
};

/** Posting terms by kind: `soft` holds the policy's `keywordMatch.softSkills`, `hard` the rest. */
export type AtsKeywordGroups = { hard: string[]; soft: string[] };

/**
 * Something worth knowing that is not scored: the file (name, size, password, tracked changes),
 * details that can invite age bias where the region pack says so, and a named target ATS. Never
 * part of the score, categories, failed checks or fixes. The text comes from the policy (`advice`).
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
 * advice needing an absent one is skipped. Pasted text has no file: pass nothing.
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

/**
 * What `check` returns: the readiness score and its rules, the fields an ATS would store, the job
 * match when a posting was given, and unscored advice. A pure function of the resume, the policy
 * and the options (`now` included).
 */
export type AtsReport = {
  /** The scoring policy's declared `version` ("ats-v2" for the community policy). */
  version: string;
  readinessScore: number;
  jobMatchScore: number | null;
  /** Posting terms the resume has and lacks: hard skills first, then soft; at most 12. */
  matchedKeywords: string[];
  missingKeywords: string[];
  /**
   * The same terms by kind, each group at most 12. `soft` skills weigh less in `jobMatchScore`
   * (`keywordMatch.softSkillWeight`).
   */
  matchedKeywordGroups: AtsKeywordGroups;
  missingKeywordGroups: AtsKeywordGroups;
  /** Evidence of every failed check that stops an ATS reading the document (parse and extraction). */
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
  /** The locale packs the resume was read with: extra languages and the region; empty without packs. */
  locale: { languages: string[]; region: string | null };
  /** What produced this report: the engine version and a fingerprint of the policy as applied. */
  engine: { version: string; policy: string };
  /** The posting's requirements, each judged; empty without a job description. At most 25. */
  requirements: AtsRequirement[];
  /** Unscored advice: file hygiene, age signals where the region pack asks, target ATS notes. */
  advice: AtsAdvice[];
  /** The text in the order the engine read it, when `includeLines` was asked for. At most 500 lines. */
  lines?: string[];
};
