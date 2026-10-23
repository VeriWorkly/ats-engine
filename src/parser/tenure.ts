import type { AtsParsedRole } from "../types.js";
import { monthIndex, nowMonth } from "../util/months.js";

/** Calendar months covered by at least one role, so concurrent jobs are not counted twice. */
export function monthsOfExperience(roles: AtsParsedRole[], now: Date) {
  const nowIndex = nowMonth(now);

  const spans = roles
    .flatMap((role) => {
      if (!role.start) return [];
      const start = monthIndex(role.start);
      if (start > nowIndex) return []; // not started yet
      const end = role.current ? nowIndex : role.end ? monthIndex(role.end, 12) : start;
      return [{ start, end: Math.max(start, Math.min(end, nowIndex)) }];
    })
    .sort((a, b) => a.start - b.start);

  if (!spans.length) return null;

  let total = 0;
  let cursor = -Infinity;
  for (const span of spans) {
    const from = Math.max(span.start, cursor === -Infinity ? span.start : cursor);
    if (span.end >= from) total += span.end - from + 1;
    cursor = Math.max(cursor, span.end + 1);
  }
  return total;
}
