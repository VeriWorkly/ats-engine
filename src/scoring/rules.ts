import { BULLET_PREFIX, formatTemplate, wordListPattern } from "../text/text.js";
import type { parseQuality } from "../parser/index.js";
import type { ResumeSectionKind } from "../parser/sections.js";
import type { AtsEnginePolicy, AtsEngineRule } from "../policy/schema.js";
import { policyRegex } from "../policy/regex.js";
import type { Finding } from "../checks/finding.js";
import type { AtsLayoutSignals, AtsRuleResult } from "../types.js";
import { memo } from "../util/memo.js";

export type RuleContext = {
  text: string;
  wordCount: number;
  lines: string[];
  headingLines: string[];
  contentLines: string[];
  /** Lines that extracted letter-spaced ("E X P E R I E N C E") and were read back as words. */
  letterSpacedLines: number;
  layout: AtsLayoutSignals | undefined;
  /** The email address and phone number the parser recovered; see the "position" rule kind. */
  contact: { email: string; phone: string };
  /** The section kinds the resume has a heading for; see the "section" rule kind. */
  sections: ReadonlySet<ResumeSectionKind>;
  /** Field-recovery metrics from `parseResume`; see the "parsed" rule kind. */
  quality: ReturnType<typeof parseQuality> & { dateOfBirthStated: number };
  /**
   * What the checks that read the resume itself found (see `checks/`). Null where a check does
   * not apply — copying a posting needs a posting — which drops its rule from the report.
   */
  findings: Record<FindingMetric, Finding | null>;
  policy: AtsEnginePolicy;
};

/** The bands metrics measured by a check that also quotes what it found. */
export const FINDING_METRICS = [
  "injectionPhrases",
  "invisibleCharacters",
  "homoglyphWords",
  "copiedPostingRatio",
  "stuffedTerms",
  "timelineIssues",
  "unsupportedSkills",
] as const;

export type FindingMetric = (typeof FINDING_METRICS)[number];

const isFinding = (metric: string): metric is FindingMetric =>
  (FINDING_METRICS as readonly string[]).includes(metric);

/**
 * A rule is applicable only when the evidence it reads actually exists. Layout rules measure
 * page geometry, which is present for uploaded documents and absent for pasted text — and an
 * absent signal is not a pass. Inapplicable rules are dropped from the report and from the
 * score's denominator rather than being silently awarded or silently deducted.
 */
/**
 * Where the first contact detail sits in the text, or Infinity when there is none. A rule's own
 * pattern finds its own match; without one the parser's recovered value is located.
 */
function earliestContact(rule: Extract<AtsEngineRule, { kind: "position" }>, ctx: RuleContext) {
  const patterns = positionPatterns(rule);
  const at = (pattern: RegExp | null, recovered: string) => {
    const index = pattern
      ? ctx.text.match(pattern)?.index
      : recovered
        ? // The text's whitespace is collapsed; the recovered value's ("+1 415  555 0142") is not.
          ctx.text.indexOf(recovered.replace(/\s+/g, " "))
        : -1;
    return index === undefined || index < 0 ? Infinity : index;
  };
  return Math.min(at(patterns.email, ctx.contact.email), at(patterns.phone, ctx.contact.phone));
}

export function isApplicable(rule: AtsEngineRule, ctx: RuleContext) {
  // Where the contact details sit means nothing when there are none; the email rule says so.
  if (rule.kind === "position") return Number.isFinite(earliestContact(rule, ctx));
  // With no line structure at all (a pasted single paragraph, or a resume that extracted as one
  // run) there are no headings to find, and failing every section on that would be a guess.
  if (rule.kind === "section") return ctx.lines.length > 1;
  // A check that does not apply to this resume (copying a posting, without one) drops its rule.
  if (rule.kind === "bands" && isFinding(rule.metric)) return ctx.findings[rule.metric] !== null;
  // A share of the recovered roles means nothing when none was recovered; `rolesDetected` says
  // so, and failing completeness on top of it charged twice for one finding.
  if (
    rule.kind === "parsed" &&
    (rule.metric === "roleCompleteness" || rule.metric === "datedRoleRatio")
  )
    return ctx.quality.rolesDetected > 0;
  if (rule.kind !== "layout") return true;
  if (!ctx.layout) return false;
  // Measured per metric, not per document: a short resume can still be checked for ruled tables
  // even though it has too few lines for the column ratio to carry any signal.
  if (rule.metric === "imageCount") return ctx.layout.imageCount !== undefined;
  if (rule.metric === "hiddenTextChars") return ctx.layout.hiddenTextChars !== undefined;
  if (rule.metric === "imageOnlyPages") return ctx.layout.imageOnlyPages !== undefined;
  return rule.metric !== "columnRatio" || ctx.layout.columnRatio !== null;
}

/**
 * Which strings a `presence` rule is tested against.
 *
 * `document` is the whitespace-collapsed resume — correct for rules that ask whether something
 * exists anywhere (an email address, a date range). It is *wrong* for anything line-anchored:
 * the collapsed string has no newlines, so a `^` under the `m` flag has nothing to bind to and
 * matches only offset zero. `line` and `heading` exist so those rules test what they mean to.
 */
function presenceTargets(scope: "document" | "line" | "heading", ctx: RuleContext) {
  if (scope === "line") return ctx.lines.length ? ctx.lines : [ctx.text];
  if (scope === "heading") {
    // With no line structure at all (a pasted single-paragraph resume, or a resume that
    // extracted as one run) headings are undetectable, so fall back rather than failing every
    // structure rule on a document whose layout we simply cannot see.
    if (ctx.lines.length <= 1) return ctx.lines.length ? ctx.lines : [ctx.text];
    return ctx.headingLines;
  }
  return [ctx.text];
}

function resolveLayoutMetric(
  rule: Extract<AtsEngineRule, { kind: "layout" }>,
  ctx: RuleContext,
): number {
  // Guarded by `isApplicable`, which drops layout rules whose metric was not captured.
  if (!ctx.layout) return 0;
  if (rule.metric === "imageCount") return ctx.layout.imageCount ?? 0;
  if (rule.metric === "hiddenTextChars") return ctx.layout.hiddenTextChars ?? 0;
  if (rule.metric === "imageOnlyPages") return ctx.layout.imageOnlyPages ?? 0;
  return rule.metric === "columnRatio" ? (ctx.layout.columnRatio ?? 0) : ctx.layout.tableCount;
}

function resolveBandMetric(
  rule: Extract<AtsEngineRule, { kind: "bands" }>,
  ctx: RuleContext,
): number {
  if (rule.metric === "wordCount") return ctx.wordCount;
  if (rule.metric === "letterSpacedLines") return ctx.letterSpacedLines;
  if (isFinding(rule.metric)) return ctx.findings[rule.metric]?.value ?? 0;

  if (rule.metric === "metricsRatio" || rule.metric === "actionVerbRatio") {
    // A rule's own pattern belongs to the rule; the action verbs belong to the (localised) text,
    // which packs extend while sharing the rule object, so each is cached on its own owner.
    const re = rule.pattern
      ? ratioPattern(rule)
      : rule.metric === "actionVerbRatio"
        ? actionVerbPattern(ctx.policy.text)
        : null;
    if (!re || ctx.lines.length === 0) return 0;
    const targetLines = ratioLines(ctx);

    if (rule.metric === "metricsRatio")
      return targetLines.filter((line) => re.test(line)).length / targetLines.length;

    // Action verbs are graded on where they appear, not merely whether they appear. A single
    // verb anywhere in the document used to satisfy this check outright; what recruiters and
    // parsers actually reward is bullets that *open* with one, so the match has to land in the
    // opening few words of the line.
    // A verb-final language (`text.actionVerbAnywhere`) puts the verb at the end instead.
    // A regular past tense ("Shepherded") counts as the first word without being listed; a
    // rule with a pattern of its own is graded by that alone.
    const forms = rule.pattern ? null : actionVerbForms(ctx.policy.text);
    const opensWithVerb = (line: string) => {
      const opening = line.replace(BULLET_PREFIX, "").split(/\s+/).slice(0, 3);
      // Cut first: a 50 KB "word" of punctuation would be rescanned from every position.
      const first = (opening[0] ?? "").slice(0, 40).replace(/[^\p{L}\p{M}]{1,8}$/u, "");
      if (forms?.test(first)) return true;
      if (ctx.policy.text.actionVerbAnywhere) return re.test(line);
      return re.test(opening.join(" "));
    };
    return targetLines.filter(opensWithVerb).length / targetLines.length;
  }

  // buzzwordCount
  const lower = ctx.text.toLowerCase();
  return ctx.policy.keywordMatch.buzzwords.reduce(
    (count, phrase) => count + (lower.includes(phrase) ? 1 : 0),
    0,
  );
}

/** Without `g`, as for presence rules: `.test` on a global pattern resumes at `lastIndex`. */
const ratioPattern = memo((rule: Extract<AtsEngineRule, { kind: "bands" }>) =>
  policyRegex(rule.pattern ?? "", (rule.flags || "i").replace(/g/g, "")),
);
const actionVerbPattern = memo((text: AtsEnginePolicy["text"]) =>
  policyRegex(wordListPattern(text.actionVerbs), "i"),
);
/** Anchored: the forms describe a whole word, which is all they are tested against. */
const actionVerbForms = memo((text: AtsEnginePolicy["text"]) =>
  policyRegex(`^(?:${text.actionVerbForms.join("|")})$`, "i"),
);

/**
 * The lines both ratio metrics divide by: the bullets. Where the list markers did not survive
 * extraction (a PDF printed from Chrome draws them as paths), the lines written as sentences
 * under a role's dated line, so a resume grades the same from its PDF as from its text file;
 * counting every four-word line instead took in the contact row and the role headers. The
 * context reads them that way (`contentLinesOf` in context.ts); every line when it found none.
 */
const ratioLines = (ctx: RuleContext) =>
  ctx.contentLines.length > 0 ? ctx.contentLines : ctx.lines;

/**
 * A rule's result: its evidence template filled with `vars`, and what it cost. A failing band
 * may word its own evidence and fix (too short, too long), in place of the rule's.
 */
function result(
  rule: AtsEngineRule,
  passed: boolean,
  scoreImpact: number,
  vars: Record<string, string | number> = {},
  band?: { failEvidence?: string; fix?: string },
): AtsRuleResult {
  const failEvidence = band?.failEvidence ?? rule.failEvidence;
  return {
    id: rule.id,
    category: rule.category,
    severity: rule.severity,
    passed,
    evidence: formatTemplate(passed ? rule.passEvidence : failEvidence, vars),
    scoreImpact,
    fix: (!passed && band?.fix) || rule.fix,
  };
}

/**
 * A presence rule's pattern, compiled once per rule and stripped of `g`: a global regex carries
 * `lastIndex` between `.test()` calls, which would make results depend on how many targets precede.
 */
const presencePattern = memo((rule: Extract<AtsEngineRule, { kind: "presence" }>) =>
  policyRegex(rule.pattern, rule.flags.replace(/g/g, "")),
);

/** A position rule's own patterns, compiled once per rule; null where it locates the parser's. */
const positionPatterns = memo((rule: Extract<AtsEngineRule, { kind: "position" }>) => ({
  email: rule.emailPattern ? policyRegex(rule.emailPattern, "i") : null,
  phone: rule.phonePattern ? policyRegex(rule.phonePattern, "") : null,
}));

export function evaluateRule(rule: AtsEngineRule, ctx: RuleContext): AtsRuleResult {
  if (rule.kind === "min-words") {
    const passed = ctx.wordCount >= rule.min;
    return result(rule, passed, passed ? 0 : rule.weight, { n: ctx.wordCount });
  }

  if (rule.kind === "presence") {
    const re = presencePattern(rule);
    const matched = presenceTargets(rule.scope, ctx).some((target) => re.test(target));
    const passed = rule.invert ? !matched : matched;
    return result(rule, passed, passed ? 0 : rule.weight);
  }

  if (rule.kind === "section") {
    const passed = ctx.sections.has(rule.section);
    return result(rule, passed, passed ? 0 : rule.weight);
  }

  if (rule.kind === "position") {
    // Applicable only when a contact detail was found (see `isApplicable`), so it is finite.
    const passed = earliestContact(rule, ctx) <= ctx.text.length * rule.windowFraction;
    return result(rule, passed, passed ? 0 : rule.weight);
  }

  // kind === "bands" | "layout" | "parsed" — all three grade a number against ordered thresholds.
  const value =
    rule.kind === "layout"
      ? resolveLayoutMetric(rule, ctx)
      : rule.kind === "parsed"
        ? ctx.quality[rule.metric]
        : resolveBandMetric(rule, ctx);
  const band =
    rule.bands.find((candidate) => candidate.upTo !== null && value <= candidate.upTo) ??
    rule.bands[rule.bands.length - 1];
  const passed = band.weight === 0;
  // `{sample}` quotes what a check found, so the candidate sees the text in question.
  const sample =
    rule.kind === "bands" && isFinding(rule.metric)
      ? (ctx.findings[rule.metric]?.sample ?? "")
      : rule.kind === "layout" && rule.metric === "hiddenTextChars"
        ? (ctx.layout?.hiddenTextSample ?? "")
        : "";
  return result(
    rule,
    passed,
    band.weight,
    { n: Math.round(value), pct: Math.round(value * 100), sample },
    band,
  );
}

/**
 * The worst this rule could have cost. For everything except banded rules that is simply the
 * rule's weight; a banded rule's ceiling is its heaviest band. Used to turn per-rule impacts
 * into a per-category percentage and to normalise the headline score — the individual weights
 * never leave the server.
 */
export function maxImpactOf(rule: AtsEngineRule): number {
  if (rule.kind === "bands" || rule.kind === "layout" || rule.kind === "parsed")
    return rule.bands.reduce((worst, band) => Math.max(worst, band.weight), 0);
  return rule.weight;
}
