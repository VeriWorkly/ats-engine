import type { AtsEngineRule } from "../policy/schema.js";
import type { AtsRuleResult } from "../types.js";
import { evaluateRule, isApplicable, maxImpactOf, type RuleContext } from "./rules.js";

/**
 * The policy's applicable rules, evaluated, and the readiness score they give.
 *
 * Normalised against what the applicable rules could take away, so the score spans 0-100 with or
 * without layout geometry. Penalty rules (integrity) come off the finished score in points; an
 * honest resume is scored as if they did not exist.
 */
export function scoreRules(rules: readonly AtsEngineRule[], ctx: RuleContext) {
  const active = rules.filter((rule) => isApplicable(rule, ctx));
  const results = active.map((rule) => evaluateRule(rule, ctx));

  let lost = 0;
  let possible = 0;
  let penalty = 0;
  active.forEach((rule, index) => {
    if (rule.penalty) penalty += results[index].scoreImpact;
    else {
      lost += results[index].scoreImpact;
      possible += maxImpactOf(rule);
    }
  });
  const quality = possible > 0 ? Math.round((1 - lost / possible) * 100) : 100;
  return { active, results, readinessScore: Math.max(0, quality - penalty) };
}

/** The five passed rules that protected the most points; penalty rules are no strength. */
export function strengthsOf(active: readonly AtsEngineRule[], results: readonly AtsRuleResult[]) {
  return results
    .map((result, index) => ({ result, rule: active[index] }))
    .filter(({ result, rule }) => result.passed && !rule.penalty)
    .sort((a, b) => maxImpactOf(b.rule) - maxImpactOf(a.rule))
    .slice(0, 5)
    .map(({ result }) => result.evidence);
}
