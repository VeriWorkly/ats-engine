/**
 * A date as a count of months, on one scale with `nowMonth`. A missing month reads as `fallback`:
 * January (the default) for a start, December (12) for an end, so a year is read generously.
 */
export const monthIndex = (date: { year: number; month: number | null }, fallback = 1) =>
  date.year * 12 + (date.month ?? fallback) - 1;

/** The month `now` falls in, on the scale of `monthIndex`. */
export const nowMonth = (now: Date) => now.getUTCFullYear() * 12 + now.getUTCMonth();
