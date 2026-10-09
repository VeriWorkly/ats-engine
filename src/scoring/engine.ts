import { prepareResume, type AtsResumeInput, type PreparedResume } from "../input.js";
import { localizePolicy, type AtsLocaleOptions } from "../locales/resolve.js";
import { computeJobMatch } from "../matching/jobMatch.js";
import { judgeRequirements, withHeadings, type HeadedSection } from "../matching/requirements.js";
import { policyFingerprint } from "../policy/fingerprint.js";
import type { AtsEnginePolicy } from "../policy/schema.js";
import { BULLET_PREFIX, normalizeText } from "../text/text.js";
import type { AtsLayoutSignals, AtsReport } from "../types.js";
import { ENGINE_VERSION } from "../version.js";
import { rollUpCategories } from "./categories.js";
import { readResume } from "./context.js";
import { scoreRules, strengthsOf } from "./score.js";

/**
 * Postings past this are cut: every step that reads a posting is linear in it, and a real one
 * is a few thousand characters. The AI tasks cut at the same length.
 */
const MAX_JOB_DESCRIPTION_CHARS = 20_000;

/** Format metrics that measure how the text extracts, as opposed to choices like length. */
const EXTRACTION_METRICS = new Set(["columnRatio", "tableCount", "letterSpacedLines"]);

/** Enough for any resume; a document past it is not one. */
const MAX_REPORTED_LINES = 500;

/**
 * Whether a resume line is visible: not part of the text the file's layout reports as hidden
 * (white on white, a 1pt font, off the page). The extractor reports the hidden text in full up to
 * 5,000 characters (`hiddenText`), or, from an older extractor, its first 80 (`hiddenTextSample`);
 * a line is set aside when the hidden text contains it, or, that text being cut, when the line
 * begins with it. The integrity cap on the job match covers whatever is past the cut.
 */
function visibleLine(layout: AtsLayoutSignals | undefined) {
  const full = layout?.hiddenText !== undefined;
  const hidden = normalizeText(layout?.hiddenText ?? layout?.hiddenTextSample ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!hidden || !layout?.hiddenTextChars) return () => true;
  const cut = hidden.length >= (full ? 5_000 : 80);
  return (line: string) => {
    const text = line.replace(BULLET_PREFIX, "").replace(/\s+/g, " ").trim();
    if (text.length < 4) return true;
    return !(hidden.includes(text) || (cut && text.startsWith(hidden)));
  };
}

/** Everything `check` reads besides the resume and the policy. */
export type AtsCheckOptions = {
  /** Enables job match scoring. Read up to its first 20 000 characters. */
  jobDescription?: string;
  /**
   * The employer that posted the job, when the host knows it (the `company` of `/job`'s
   * `extractJobPosting`). Every word of it is left out of the job-match keywords.
   */
  jobCompany?: string;
  /** Page geometry from a file upload. Absent for text and documents; layout rules then drop out. */
  layout?: AtsLayoutSignals;
  /**
   * The reference date for the tenure of a current role and for the plausible-year ceiling.
   * Defaults to the current time; pass a fixed value wherever a result must be reproducible.
   */
  now?: Date;
  /**
   * Return the text as the engine read it, one entry per line (`report.lines`). Off by default:
   * it is the resume's full text. Worth showing a candidate, because reading order — not columns
   * as such — is what breaks a multi-column layout, and it is visible only here.
   */
  includeLines?: boolean;
} & AtsLocaleOptions;

export class AtsScoringService {
  /**
   * Scores a resume against a policy.
   *
   * The policy is a parameter rather than something this module fetches: loading it is I/O and
   * caching it is state, and a library that scores text should do neither. The report is a pure
   * function of (resume, policy, options).
   *
   * `resume` may be raw input or a `PreparedResume`. Throws `AtsInputError` for a structured
   * document that fails validation.
   *
   * When locale packs are attached to the policy (`withLocales`), the resume and the posting are
   * read in the languages they are detected as, and in one region; `report.locale` says which.
   */
  static check(
    resume: AtsResumeInput | PreparedResume,
    basePolicy: AtsEnginePolicy,
    options: AtsCheckOptions = {},
  ): AtsReport {
    const { layout, now = new Date() } = options;
    // Untyped callers send anything; only a string is a posting.
    // Normalised as the resume is: a no-break space or a zero-width space pasted from a careers
    // page split "Machine learning" and "Kubernetes" into words no resume had.
    const jobDescription =
      typeof options.jobDescription === "string"
        ? normalizeText(options.jobDescription.slice(0, MAX_JOB_DESCRIPTION_CHARS))
        : undefined;
    const prepared = prepareResume(resume);
    const { policy, locale, resumeLanguages } = localizePolicy(
      basePolicy,
      jobDescription === undefined ? prepared.text : `${prepared.text}\n${jobDescription}`,
      options,
      prepared.text,
    );

    const { ctx, lines, sections, parsed } = readResume(prepared, policy, {
      jobDescription,
      layout,
      now,
      languages: resumeLanguages,
    });
    const { active, results, readinessScore } = scoreRules(policy.rules, ctx);
    const failedChecks = results.filter((rule) => !rule.passed);
    const metricOf = new Map(
      active.map((rule) => [rule.id, "metric" in rule ? String(rule.metric) : ""]),
    );

    // Hidden text is no evidence of fit: the match and the requirements read only what a reader
    // sees. And when the resume was caught gaming the screener (an integrity error), the match
    // is held to the readiness score that carries the deduction, as the verdict already is.
    // Only text the policy's hidden-text rule fails is set aside: below its threshold a few
    // hidden characters are layout, and the rule says so by passing.
    const hiddenRule = active.find((rule) => metricOf.get(rule.id) === "hiddenTextChars");
    const hiding = !hiddenRule || failedChecks.some((rule) => rule.id === hiddenRule.id);
    const visible = hiding ? visibleLine(layout) : () => true;
    const shown = lines.filter(visible);
    const headed = withHeadings(lines, sections);
    const shownSections: HeadedSection[] =
      shown.length === lines.length
        ? headed
        : headed.map((section) => ({ ...section, lines: section.lines.filter(visible) }));
    const jobMatch = computeJobMatch(
      shown.length === lines.length ? ctx.text : shown.join(" ").replace(/\s+/g, " ").trim(),
      jobDescription,
      policy,
      parsed.highestIsced,
      options.jobCompany,
    );
    const caught = failedChecks.some(
      (rule) => rule.category === "integrity" && rule.severity === "error",
    );
    const jobMatchScore =
      caught && jobMatch.score !== null ? Math.min(jobMatch.score, readinessScore) : jobMatch.score;

    return {
      version: policy.version,
      readinessScore,
      jobMatchScore,
      matchedKeywords: jobMatch.matched,
      missingKeywords: jobMatch.missing,
      matchedKeywordGroups: jobMatch.matchedGroups,
      missingKeywordGroups: jobMatch.missingGroups,
      // What stops an ATS reading the document: every parse check, and the format checks that
      // measure how the text extracts (columns, tables, letter spacing). Length and a photo are
      // format choices, not reading problems, and stay out. Matched on category and metric rather
      // than a substring of the rule id, which is only a naming convention.
      parsingWarnings: failedChecks
        .filter(
          (rule) =>
            rule.category === "parse" ||
            (rule.category === "format" && EXTRACTION_METRICS.has(metricOf.get(rule.id) ?? "")),
        )
        .map((rule) => rule.evidence),
      strengths: strengthsOf(active, results),
      failedChecks,
      prioritizedFixes: [...failedChecks]
        .sort((a, b) => b.scoreImpact - a.scoreImpact)
        .slice(0, 6)
        .map((rule) => rule.fix),
      rules: results,
      categories: rollUpCategories(active, results),
      checksPassed: results.length - failedChecks.length,
      checksTotal: results.length,
      wordCount: ctx.wordCount,
      parsed,
      locale,
      engine: { version: ENGINE_VERSION, policy: policyFingerprint(policy) },
      requirements: judgeRequirements(jobDescription, shownSections, parsed, policy, now),
      ...(options.includeLines && { lines: lines.slice(0, MAX_REPORTED_LINES) }),
    };
  }
}
