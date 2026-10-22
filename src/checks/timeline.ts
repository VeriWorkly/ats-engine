import { formatParsedDate } from "../format/index.js";
import type { AtsParsedDate, AtsParsedRole } from "../types.js";
import { monthIndex, nowMonth } from "../util/months.js";
import { NO_FINDING, type Finding } from "./finding.js";

const MAX_CONCURRENT = 2;
const MIN_OVERLAP_MONTHS = 3;
const MAX_CAREER_MONTHS = 50 * 12;

/**
 * Dates in the work history that cannot all be true: a role starting after today, more than two
 * roles held at once for over three months, a career longer than a working life. A gap between
 * roles is deliberately not one. Null when no role is dated.
 */
export function timelineIssues(
  roles: AtsParsedRole[],
  monthsOfExperience: number | null,
  now: Date,
): Finding | null {
  if (!roles.some((role) => role.start)) return null;
  const today = nowMonth(now);
  const issues: string[] = [];

  for (const role of roles)
    if (role.start && monthIndex(role.start) > today + 1)
      issues.push(
        `${role.title || "a role"} starts in ${formatParsedDate(role.start)}, after today`,
      );

  const spans = roles
    .filter((role): role is AtsParsedRole & { start: AtsParsedDate } => role.start !== null)
    // A role with no end that is not current spans its start month, as `monthsOfExperience` counts
    // it. An end with no month ends in January, not December, so "2017 - 2020" then "2020 - 2024"
    // is a handover, not a year-long overlap.
    .map((role) => {
      const from = monthIndex(role.start);
      return [from, role.current ? today : role.end ? monthIndex(role.end) : from];
    })
    .filter(([from, to]) => to >= from);
  // Bounded by a working life: a mistyped 1950 start costs 600 steps.
  const earliest = spans.length ? Math.min(...spans.map(([from]) => from)) : today + 1;
  const last = Math.min(today, earliest + MAX_CAREER_MONTHS);
  let crowded = 0;
  let firstCrowded = -1;
  for (let month = earliest; month <= last; month += 1) {
    const held = spans.filter(([from, to]) => from <= month && month <= to).length;
    if (held <= MAX_CONCURRENT) continue;
    crowded += 1;
    if (firstCrowded < 0) firstCrowded = month;
  }
  if (crowded >= MIN_OVERLAP_MONTHS) {
    const year = Math.floor(firstCrowded / 12);
    issues.push(`more than ${MAX_CONCURRENT} roles overlap from ${year}`);
  }

  if (monthsOfExperience !== null && monthsOfExperience > MAX_CAREER_MONTHS)
    issues.push(
      `${Math.round(monthsOfExperience / 12)} years of experience is longer than a career`,
    );

  return issues.length ? { value: issues.length, sample: issues[0] } : NO_FINDING;
}
