import { adviceFor, targetOf } from "../advice/index.js";
import { prepareResume, type AtsResumeInput, type PreparedResume } from "../input.js";
import { localizePolicy, type AtsLocaleOptions } from "../locales/resolve.js";
import { computeJobMatch } from "../matching/jobMatch.js";
import { judgeRequirements, withHeadings, type HeadedSection } from "../matching/requirements.js";
import { readingDatesAt } from "../parser/dates.js";
import { policyFingerprint } from "../policy/fingerprint.js";
import type { AtsEnginePolicy } from "../policy/schema.js";
import { BULLET_PREFIX, normalizeText } from "../text/text.js";
import type { AtsFileInfo, AtsLayoutSignals, AtsReport } from "../types.js";
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
 *
 * Each stretch of hidden text sets aside one line, the longest lines claiming theirs first: a
 * visible "Kubernetes" skill stays when the hidden text is "Kubernetes Terraform Kafka", which
 * the hidden line of that text claims whole. A line is kept only when every place the hidden text
 * holds it lies inside text already claimed, so a visible line across two hidden ones never frees
 * them. Returns a filter for each pass over the lines, each setting aside as many lines of a text
 * as the hidden text holds.
 */
function visibleLines(layout: AtsLayoutSignals | undefined, lines: readonly string[]) {
  const full = layout?.hiddenText !== undefined;
  const hidden = normalizeText(layout?.hiddenText ?? layout?.hiddenTextSample ?? "")
    .replace(/\s+/g, " ")
    .trim();
  const textOf = (line: string) => line.replace(BULLET_PREFIX, "").replace(/\s+/g, " ").trim();
  if (!hidden || !layout?.hiddenTextChars) return () => () => true;
  const cut = hidden.length >= (full ? 5_000 : 80);
  const counts = new Map<string, number>();
  // `next[i]`: the first position from `i` no line has claimed, its path shortened as it is read,
  // so claiming and asking cost next to nothing however many lines there are.
  const next = Array.from({ length: hidden.length + 1 }, (_, i) => i);
  const free = (i: number) => {
    while (next[i] !== i) i = next[i] = next[next[i]!]!;
    return i;
  };
  // Where a text's next search starts: a second line of the same text claims the next place.
  const from = new Map<string, number>();
  for (const text of lines.map(textOf).sort((a, b) => b.length - a.length)) {
    if (text.length < 4) break;
    let at = hidden.indexOf(text, from.get(text) ?? 0);
    while (at >= 0 && free(at) >= at + text.length) at = hidden.indexOf(text, at + 1);
    if (at >= 0) {
      from.set(text, at + 1);
      for (let i = free(at); i < at + text.length; i = free(i)) next[i] = i + 1;
    } else if (!(cut && text.startsWith(hidden))) continue;
    counts.set(text, (counts.get(text) ?? 0) + 1);
  }
  return () => {
    const unclaimed = new Map(counts);
    return (line: string) => {
      const text = textOf(line);
      const n = unclaimed.get(text);
      if (!n) return true;
      unclaimed.set(text, n - 1);
      return false;
    };
  };
}

/** Everything `check` reads besides the resume and the policy. */
export type AtsCheckOptions = {
  /** Enables job match scoring. Read up to its first 20 000 characters. */
  jobDescription?: string | undefined;
  /**
   * The employer that posted the job, when the host knows it (the `company` of `/job`'s
   * `extractJobPosting`). Every word of it is left out of the job-match keywords.
   */
  jobCompany?: string | undefined;
  /**
   * Layout signals from a file upload (`extractResume`): page geometry, hidden text, and what the
   * file advice reads (an encrypted PDF, a Word document's tracked changes and comments). Absent
   * for pasted text and structured documents; the layout rules then drop out.
   */
  layout?: AtsLayoutSignals | undefined;
  /**
   * The reference date for the tenure of a current role and for the plausible-year ceiling.
   * Defaults to the current time; pass a fixed value wherever a result must be reproducible.
   */
  now?: Date | undefined;
  /**
   * Return the text as the engine read it, one entry per line (`report.lines`). Off by default:
   * it is the resume's full text. Worth showing a candidate, because reading order — not columns
   * as such — is what breaks a multi-column layout, and it is visible only here.
   */
  includeLines?: boolean | undefined;
  /**
   * What the host knows of the uploaded file — its name, size, format, a password, tracked
   * changes, comments — for the file advice in `report.advice`. Never scored. Absent for pasted
   * text.
   */
  file?: AtsFileInfo | undefined;
  /**
   * An applicant tracking system the resume is headed for, by its id in the policy
   * (`advice.targets`: "greenhouse", "lever", "taleo" in the community policy). Adds that
   * vendor's documented notes to `report.advice`, each with its source; never scored. Throws
   * `AtsPolicyError` for an id the policy has no notes on.
   */
  targetAts?: string | undefined;
} & AtsLocaleOptions;

/** The scorer behind `check`. `AtsScoringService.check` gives the same report, until 1.0. */
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
    const { layout } = options;
    // This check's own: the lines it reads for dates are read once for as long as it lasts.
    const now = readingDatesAt(options.now ?? new Date());
    // Untyped callers send anything; only a string is a posting.
    // Normalised as the resume is: a no-break space or a zero-width space pasted from a careers
    // page split "Machine learning" and "Kubernetes" into words no resume had.
    const jobDescription =
      typeof options.jobDescription === "string"
        ? normalizeText(options.jobDescription.slice(0, MAX_JOB_DESCRIPTION_CHARS))
        : undefined;
    // Refused before any work, as an unknown region is.
    const target = targetOf(basePolicy, options.targetAts);
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
    const visible = hiding ? visibleLines(layout, lines) : () => () => true;
    const shown = lines.filter(visible());
    const headed = withHeadings(lines, sections);
    const inSections = visible();
    const shownSections: HeadedSection[] =
      shown.length === lines.length
        ? headed
        : headed.map((section) => ({ ...section, lines: section.lines.filter(inSections) }));
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
      // Read after the score is final, from nothing the score reads: advice cannot move it.
      advice: adviceFor(policy, { parsed, lines, now, file: options.file, layout, target }),
      ...(options.includeLines && { lines: lines.slice(0, MAX_REPORTED_LINES) }),
    };
  }
}
