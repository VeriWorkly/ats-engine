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
  /**
   * The languages the resume is read in: the attached packs it is written in, else the policy's
   * `text.language`, or "und" for one of `text.otherLanguages`. A rule with `languages` applies
   * only when each is among them.
   */
  languages: readonly string[];
  /** Lines that extracted letter-spaced ("E X P E R I E N C E") and were read back as words. */
  letterSpacedLines: number;
  layout: AtsLayoutSignals | undefined;
  /** The email address and phone number the parser recovered; see the "position" rule kind. */
  contact: { email: string; phone: string };
  /** The section kinds the resume has a heading for; see the "section" rule kind. */
  sections: ReadonlySet<ResumeSectionKind>;
  /** Field-recovery metrics from `parseResume`; see the "parsed" rule kind. */
  quality: ReturnType<typeof parseQuality> & { dateOfBirthStated: number };
  /** What the checks found (see `checks/`); null where one does not apply, dropping its rule. */
  findings: Record<FindingMetric, Finding | null>;
  policy: AtsEnginePolicy;
};

/** Bands metrics measured by a check that also quotes what it found. */
const FINDING_METRICS = [
  "injectionPhrases",
  "invisibleCharacters",
  "homoglyphWords",
  "copiedPostingRatio",
  "stuffedTerms",
  "timelineIssues",
  "unsupportedSkills",
  "firstPersonLines",
  "passiveVoiceRatio",
  "weakOpeners",
  "tenseMismatches",
  "longBullets",
  "bulletsPerRole",
  "repeatedOpeners",
  "dateFormats",
] as const;

export type FindingMetric = (typeof FINDING_METRICS)[number];

const isFinding = (metric: string): metric is FindingMetric =>
  (FINDING_METRICS as readonly string[]).includes(metric);

/** Where the first contact detail sits in the text, or Infinity when there is none. */
function earliestContact(ctx: RuleContext) {
  const at = (recovered: string) => {
    // The text's whitespace is collapsed; the recovered value's ("+1 415  555 0142") is not.
    const index = recovered ? ctx.text.indexOf(recovered.replace(/\s+/g, " ")) : -1;
    return index < 0 ? Infinity : index;
  };
  return Math.min(at(ctx.contact.email), at(ctx.contact.phone));
}

/**
 * Whether the evidence a rule reads exists. An absent signal is not a pass: inapplicable rules
 * are dropped from the report and the score's denominator.
 */
export function isApplicable(rule: AtsEngineRule, ctx: RuleContext) {
  const { languages } = rule;
  if (languages && !ctx.languages.every((language) => languages.includes(language))) return false;
  // Position means nothing without contact details; the email rule says so.
  if (rule.kind === "position") return Number.isFinite(earliestContact(ctx));
  // No line structure means no headings to find; failing every section would be a guess.
  if (rule.kind === "section") return ctx.lines.length > 1;
  if (rule.kind === "bands" && isFinding(rule.metric)) return ctx.findings[rule.metric] !== null;
  // A share of roles means nothing with none recovered; `rolesDetected` already says so.
  if (
    rule.kind === "parsed" &&
    (rule.metric === "roleCompleteness" || rule.metric === "datedRoleRatio")
  )
    return ctx.quality.rolesDetected > 0;
  if (rule.kind !== "layout") return true;
  if (!ctx.layout) return false;
  // Per metric: a short resume can still be checked for ruled tables.
  if (rule.metric === "imageCount") return ctx.layout.imageCount !== undefined;
  if (rule.metric === "hiddenTextChars") return ctx.layout.hiddenTextChars !== undefined;
  if (rule.metric === "imageOnlyPages") return ctx.layout.imageOnlyPages !== undefined;
  return rule.metric !== "columnRatio" || ctx.layout.columnRatio !== null;
}

/**
 * Which strings a `presence` rule is tested against. `document` is whitespace-collapsed, so a
 * line-anchored `^` only binds at offset zero: those rules use `line` or `heading`.
 */
function presenceTargets(scope: "document" | "line" | "heading", ctx: RuleContext) {
  if (scope === "line") return ctx.lines.length ? ctx.lines : [ctx.text];
  if (scope === "heading") {
    // No line structure: headings are undetectable, so fall back rather than fail every rule.
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
    // The rule's pattern and the localised action verbs are cached on their own owners: packs
    // extend the text while sharing the rule object.
    const re = rule.pattern
      ? ratioPattern(rule)
      : rule.metric === "actionVerbRatio"
        ? actionVerbPattern(ctx.policy.text)
        : null;
    if (!re || ctx.lines.length === 0) return 0;
    const targetLines = ratioLines(ctx);

    if (rule.metric === "metricsRatio")
      return targetLines.filter((line) => re.test(line)).length / targetLines.length;

    // The verb must open the line (first three words); `text.actionVerbAnywhere` lifts that for
    // verb-final languages. A regular past tense ("Shepherded") counts as the first word; a rule
    // with its own pattern is graded by that alone.
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

/** The lines both ratio metrics divide by (`contentLinesOf` in context.ts), else every line. */
const ratioLines = (ctx: RuleContext) =>
  ctx.contentLines.length > 0 ? ctx.contentLines : ctx.lines;

/** A rule's result; a failing band may word its own evidence and fix. */
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

/** Compiled once per rule, without `g`: a global regex carries `lastIndex` between tests. */
const presencePattern = memo((rule: Extract<AtsEngineRule, { kind: "presence" }>) =>
  policyRegex(rule.pattern, rule.flags.replace(/g/g, "")),
);

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
    // Finite: `isApplicable` requires a contact detail.
    const passed = earliestContact(ctx) <= ctx.text.length * rule.windowFraction;
    return result(rule, passed, passed ? 0 : rule.weight);
  }

  // "bands", "layout" and "parsed" grade a number against ordered thresholds.
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
  const sample =
    rule.kind === "bands" && isFinding(rule.metric)
      ? (ctx.findings[rule.metric]?.sample ?? "")
      : rule.kind === "layout" && rule.metric === "hiddenTextChars"
        ? (ctx.layout?.hiddenText?.slice(0, 80) ?? "")
        : "";
  return result(
    rule,
    passed,
    band.weight,
    { n: Math.round(value), pct: Math.round(value * 100), sample },
    band,
  );
}

/** The most a rule can cost: its weight, or its heaviest band. */
export function maxImpactOf(rule: AtsEngineRule): number {
  if (rule.kind === "bands" || rule.kind === "layout" || rule.kind === "parsed")
    return rule.bands.reduce((worst, band) => Math.max(worst, band.weight), 0);
  return rule.weight;
}
