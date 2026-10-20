import {
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from "libphonenumber-js/min";

import type { AtsEnginePolicy } from "../policy/schema.js";
import { findDateRange } from "./dates.js";

/**
 * A run that could be a phone number: an optional "+", then 7 to 15 digits (E.164) with at most
 * three separators between any two. Linear by construction (every repetition consumes a digit;
 * libphonenumber's own finder is quadratic on "1 1 1 …"). Separators never include a line break.
 */
const CANDIDATE = /(?<![\p{L}\p{N}+])(?:\+[ \t]?)?\(?\d(?:[ \t.\-()/]{0,3}\d){6,14}(?!\d)/gu;

/** A full numeric date ("04.05.1990", "2021/03/15"), which has the digits of a phone number. */
const NUMERIC_DATE = /^\d{1,4}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,4}$/;

/** Enough for a header and a footer. */
const MAX_CANDIDATES = 40;

/**
 * The first phone number in the text, as printed, or "". Each candidate must pass libphonenumber's
 * validity check, with its own country code or as a national number of each of the policy's
 * `phoneRegions`. Runs that read as a date or date range are skipped first (German numbering
 * accepts "2019 2022").
 */
export function findPhone(text: string, policy: AtsEnginePolicy, now: Date): string {
  const regions = policy.resumeParse.phoneRegions.filter((code): code is CountryCode =>
    isSupportedCountry(code),
  );
  let seen = 0;

  for (const match of text.matchAll(CANDIDATE)) {
    if (++seen > MAX_CANDIDATES) break;
    const raw = match[0].trim().replace(/(?<![\s.\-(/])[\s.\-(/]+$/, "");
    if (NUMERIC_DATE.test(raw) || findDateRange(raw, policy.resumeParse, now)) continue;

    const valid = raw.startsWith("+")
      ? parsePhoneNumberFromString(raw)?.isValid()
      : regions.some((region) => parsePhoneNumberFromString(raw, region)?.isValid());
    if (valid) return raw;
  }
  return "";
}

/** The country of the first phone number written with a country code, if there is one. */
export function phoneCountry(text: string): CountryCode | undefined {
  let seen = 0;
  for (const match of text.matchAll(CANDIDATE)) {
    if (++seen > MAX_CANDIDATES) break;
    if (!match[0].trimStart().startsWith("+")) continue;
    const parsed = parsePhoneNumberFromString(match[0].trim());
    if (parsed?.isValid() && parsed.country) return parsed.country;
  }
  return undefined;
}
