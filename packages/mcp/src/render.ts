/**
 * The text each tool returns for the model to read. The same facts as the structured content, in
 * the order a person reads a report: score, what failed and how to fix it, what was read.
 */

import type { AtsReport, AtsRequirement, AtsRubricEntry, AtsVerdict } from "@veriworkly/ats-engine";
import { categoryLabel, formatRoleDates, formatTenure } from "@veriworkly/ats-engine/format";

/** Said in every scored answer, so the assistant does not present the score as its own opinion. */
export function provenance(report: AtsReport): string {
  return (
    `Scored by the published, deterministic ATS Engine rubric (engine ${report.engine.version}, ` +
    `policy ${report.engine.policy}); no AI model produced this score.`
  );
}

function requirementLine(requirement: AtsRequirement): string {
  const preferred = requirement.importance === "preferred" ? " (preferred)" : "";
  const detail = requirement.detail ? ` — ${requirement.detail}` : "";
  return `- [${requirement.status}] ${requirement.text}${preferred}${detail}`;
}

export function renderJobMatch(report: AtsReport): string[] {
  const lines = [`Job match: ${report.jobMatchScore ?? "—"}/100`];
  if (report.requirements.length) {
    const met = report.requirements.filter((requirement) => requirement.status === "met").length;
    lines.push(`Requirements met: ${met} of ${report.requirements.length}`);
    lines.push(...report.requirements.map(requirementLine));
  }
  if (report.missingKeywords.length)
    lines.push(`Missing keywords: ${report.missingKeywords.join(", ")}`);
  return lines;
}

export function renderCheck(report: AtsReport, verdict: AtsVerdict, withJob: boolean): string {
  const { parsed } = report;
  const lines = [
    provenance(report),
    "",
    `Readiness: ${report.readinessScore}/100 — verdict: ${verdict.replace("-", " ")} — ` +
      `${report.checksPassed}/${report.checksTotal} checks passed`,
  ];
  const read = [...report.locale.languages, report.locale.region].filter(Boolean);
  if (read.length) lines.push(`Read as: ${read.join(", ")}`);

  lines.push("", "Categories:");
  for (const category of report.categories)
    lines.push(`- ${categoryLabel(category.category)}: ${category.score}/100`);

  if (withJob) lines.push("", ...renderJobMatch(report));

  lines.push("", report.failedChecks.length ? "Failed checks:" : "Failed checks: none");
  for (const rule of report.failedChecks)
    lines.push(
      `- [${rule.severity}] ${rule.id} (${categoryLabel(rule.category)}): ${rule.evidence}`,
      `  Fix: ${rule.fix}`,
    );

  lines.push("", "What an ATS reads:");
  lines.push(`- Name: ${parsed.name || "—"}`);
  lines.push(`- Email: ${parsed.email || "—"}`);
  lines.push(`- Phone: ${parsed.phone || "—"}`);
  if (parsed.links.length) lines.push(`- Links: ${parsed.links.join(", ")}`);
  for (const role of parsed.roles) {
    const dates = formatRoleDates(role);
    const name = [role.title, role.employer].filter(Boolean).join(", ") || "—";
    lines.push(`- Role: ${name}${dates ? ` (${dates})` : ""}`);
  }
  if (!parsed.roles.length) lines.push("- Roles: none found");
  for (const school of parsed.education)
    lines.push(
      `- Education: ${[school.credential, school.school].filter(Boolean).join(", ") || "—"}`,
    );
  if (parsed.monthsOfExperience)
    lines.push(`- Experience: ${formatTenure(parsed.monthsOfExperience)}`);
  if (parsed.skills.length) lines.push(`- Skills: ${parsed.skills.join(", ")}`);
  return lines.join("\n");
}

export function renderRule(entry: AtsRubricEntry): string {
  const cost = entry.deduction
    ? `deducts up to ${entry.points} points when it fails (a penalty outside the score's denominator)`
    : `weighs ${entry.points} points in the readiness score`;
  return [
    `${entry.id} — ${categoryLabel(entry.category)}, ${entry.severity}`,
    `Checks: ${entry.measures}. It ${cost}.`,
    `Passes when: ${entry.passes}`,
    `Fix: ${entry.fix}`,
    "",
    "From the published, deterministic rubric of the bundled community policy.",
  ].join("\n");
}
