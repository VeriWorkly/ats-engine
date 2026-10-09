import type { AtsEnginePolicy } from "../policy/schema.js";
import { BULLET, BULLET_PREFIX, wordListPattern } from "../text/text.js";
import type { AtsParsedCertification } from "../types.js";
import { memo } from "../util/memo.js";
import { findDates } from "./dates.js";

/**
 * Certifications and licences as rows: "AWS Certified Solutions Architect – Associate, Amazon
 * Web Services, 2023" is a name, an issuer and the year it was earned; "PMP (PMI), expires 2027"
 * a name, an issuer in brackets and an expiry.
 *
 * A line is cut into parts at its separators — commas, bars, dots, an em dash, a column gap —
 * outside brackets. Spaced en dashes and hyphens cut only when nothing else does and there are
 * two of them ("ITIL 4 Foundation – AXELOS – 2020"): one is as often inside the name ("AWS
 * Certified Developer – Associate"). Dates come out of each part with the word before them
 * (`credentialWords`), which says whether a date is the expiry; what is left is the name, then the
 * issuer.
 */

/** A line longer than this is a sentence about a certification, not one. */
const MAX_LINE = 200;
const MAX_FIELD = 160;
/** How far before a date its label is looked for: "Expiration date: ". */
const LABEL_REACH = 40;

type Words = {
  expires: RegExp;
  issued: RegExp;
  /** Either label opening a text: what may follow a date that is still a date. */
  opening: RegExp;
  /** A part opening with an id label: "Credential ID 9X7Y". */
  id: RegExp;
  /** An issuer word inside the name part, with spaces either side: " from Google Cloud". */
  issuerInside: RegExp;
  /** An issuer word opening a part: "Issued by Amazon". */
  issuerOpening: RegExp;
};

const wordsOf = memo((rp: AtsEnginePolicy["resumeParse"]): Words => {
  const { expires, issued, id, issuer } = rp.credentialWords;
  // Anchored at the end of a bounded slice, so each test is a short scan.
  const label = (list: readonly string[]) => new RegExp(`${wordListPattern(list)}[\\s:.]*$`, "iu");
  return {
    expires: label(expires),
    issued: label(issued),
    opening: new RegExp(`^\\s*${wordListPattern([...expires, ...issued])}`, "iu"),
    id: new RegExp(`^\\s*(?:${id.join("|")})(?![\\p{L}\\p{M}])`, "iu"),
    issuerInside: new RegExp(`\\s(?:${issuer.join("|")})\\s+(?=\\p{L})`, "iu"),
    issuerOpening: new RegExp(`^\\s*(?:${issuer.join("|")})\\s+`, "iu"),
  };
});

/** Spaced en dashes and hyphens: separators only when a line holds two and nothing else. */
const SPACED_DASH = /\s[–-]\s/gu;
const PRIMARY = new Set([",", ";", "|", "·", "•", "—", "\t"]);

/**
 * The line's parts, cut at its separators outside brackets. One pass; a column gap (two or more
 * spaces) cuts as a separator does.
 */
function parts(line: string): string[] {
  const dashes = (line.match(SPACED_DASH) ?? []).length;
  let primary = false;
  const out: string[] = [];
  let depth = 0;
  let from = 0;
  const cut = (at: number, width: number) => {
    out.push(line.slice(from, at));
    from = at + width;
  };
  for (let at = 0; at < line.length; at += 1) {
    const char = line[at]!;
    if (char === "(" || char === "[") depth += 1;
    else if ((char === ")" || char === "]") && depth > 0) depth -= 1;
    if (depth > 0) continue;
    if (PRIMARY.has(char)) {
      primary = true;
      cut(at, 1);
    } else if (char === " " && line[at + 1] === " ") {
      let end = at;
      while (line[end] === " ") end += 1;
      primary = true;
      cut(at, end - at);
      at = end - 1;
    }
  }
  out.push(line.slice(from));
  if (primary || dashes < 2) return out;
  return out.flatMap((part) => part.split(SPACED_DASH));
}

/** Brackets left empty by a date taken out: "Scrum Alliance (2019 - 2023)". */
const EMPTY_BRACKETS = /\(\s*[–-]?\s*\)|\[\s*[–-]?\s*\]/gu;
const LEADING = new Set([..." \t,;:|·•–—-"]);
const TRAILING = new Set([...LEADING, "("]);

const WORD_AFTER = /^ ?\p{L}/u;

/** Leftover punctuation off both ends, by a scan: a regex anchored at the end is quadratic. */
function tidy(text: string) {
  const value = text.replace(EMPTY_BRACKETS, " ").replace(/\s+/gu, " ");
  let from = 0;
  let to = value.length;
  while (from < to && LEADING.has(value[from]!)) from += 1;
  while (to > from && TRAILING.has(value[to - 1]!)) to -= 1;
  return value.slice(from, to).trim();
}

const monthIndex = (date: { year: number; month: number | null }) =>
  date.year * 12 + (date.month ?? 1);

type Dated = { date: AtsParsedCertification["date"]; expires: AtsParsedCertification["date"] };

/**
 * One part with its dates and their labels taken out, and the dates sorted: one after an expiry
 * word is the expiry, one after an issued word or unlabelled the date earned.
 */
function takeDates(
  part: string,
  rp: AtsEnginePolicy["resumeParse"],
  words: Words,
  now: Date,
  dated: Dated,
  unlabelled: Array<NonNullable<Dated["date"]>>,
) {
  let rest = "";
  let from = 0;
  for (const found of findDates(part, rp, now)) {
    const start = Math.max(from, found.index - LABEL_REACH);
    const before = part.slice(start, found.index);
    const expiry = words.expires.exec(before);
    const issued = expiry ? null : words.issued.exec(before);
    const label = expiry ?? issued;
    // An unlabelled year with a word straight after it is part of the name: "Windows Server
    // 2019 Administrator".
    const after = part.slice(found.end, found.end + LABEL_REACH);
    if (!label && WORD_AFTER.test(after) && !words.opening.test(after)) continue;
    rest += part.slice(from, label ? start + label.index : found.index);
    from = found.end;
    if (expiry) dated.expires ??= found.date;
    else if (issued) dated.date ??= found.date;
    else unlabelled.push(found.date);
  }
  return tidy(rest + part.slice(from));
}

/** Initials of a name's words: "Certified Kubernetes Administrator" → "CKA". */
const initials = (name: string) =>
  (name.match(/\p{L}[\p{L}\p{M}]*/gu) ?? []).map((word) => word[0]!.toUpperCase()).join("");

/**
 * The name and issuer of a single part: an issuer word inside it ("… from Google Cloud"), or a
 * bracket at its end that is not the name's own abbreviation ("PMP (PMI)", but not "Certified
 * Kubernetes Administrator (CKA)") and holds no exam code ("AZ-900").
 */
function nameAndIssuer(text: string, words: Words): [string, string] {
  const inside = words.issuerInside.exec(text);
  if (inside && inside.index > 0)
    return [tidy(text.slice(0, inside.index)), tidy(text.slice(inside.index + inside[0].length))];
  const bracket = /\(([^()]{1,80})\)\s*$/u.exec(text);
  if (bracket && bracket.index > 0 && !/\p{N}/u.test(bracket[1]!)) {
    const name = tidy(text.slice(0, bracket.index));
    const acronym = (bracket[1]!.match(/\p{L}[\p{L}\p{M}]*/u)?.[0] ?? "").toUpperCase();
    if (name && !initials(name).includes(acronym)) return [name, tidy(bracket[1]!)];
  }
  return [text, ""];
}

/**
 * One line as a certification row, or the dates of a line that names nothing else ("Issued Jan
 * 2021 · Expires Jan 2024", the line LinkedIn prints under a certification), or null.
 */
export function readCertification(
  line: string,
  policy: AtsEnginePolicy,
  now: Date,
): { row: AtsParsedCertification | null; dated: Dated } | null {
  const body = line.replace(BULLET_PREFIX, "").trim();
  if (!body || body.length > MAX_LINE || !/\p{L}|\p{N}/u.test(body)) return null;
  const rp = policy.resumeParse;
  const words = wordsOf(rp);
  const dated: Dated = { date: null, expires: null };
  const unlabelled: Array<NonNullable<Dated["date"]>> = [];
  const kept = parts(body)
    .filter((part) => !words.id.test(part))
    .map((part) => takeDates(part, rp, words, now, dated, unlabelled))
    .filter((part) => /\p{L}/u.test(part));
  // Unlabelled dates: the first is when it was earned, a later one when it lapses ("2019 - 2023").
  for (const date of unlabelled) {
    if (!dated.date) dated.date = date;
    else if (!dated.expires && monthIndex(date) > monthIndex(dated.date)) dated.expires = date;
  }
  if (!kept.length) return dated.date || dated.expires ? { row: null, dated } : null;

  const [first, ...others] = kept;
  let [name, issuer] = others.length ? [first!, ""] : nameAndIssuer(first!, words);
  if (others.length) issuer = tidy(others[0]!.replace(words.issuerOpening, ""));
  name = name.slice(0, MAX_FIELD);
  if (!/\p{L}/u.test(name)) return null;
  return { row: { name, issuer: issuer.slice(0, MAX_FIELD), ...dated }, dated };
}

/**
 * The rows of a certifications section. Where the section mixes plain lines and bullets, the
 * bullets describe the line above them and are skipped; a list written all in bullets is the
 * list. A line of dates alone joins the row above it. Each certification once, by name.
 */
export function parseCertifications(
  lines: readonly string[],
  policy: AtsEnginePolicy,
  now: Date,
): AtsParsedCertification[] {
  const plain = lines.some((line) => line.trim() && !BULLET.test(line));
  const rows: AtsParsedCertification[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    if (plain && BULLET.test(line)) continue;
    const read = readCertification(line, policy, now);
    if (!read) continue;
    const last = rows.at(-1);
    if (!read.row) {
      if (last) {
        last.date ??= read.dated.date;
        last.expires ??= read.dated.expires;
      }
      continue;
    }
    const key = read.row.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(read.row);
  }
  return rows;
}

/** The items of a "Certifications: AWS Certified Developer (2021), PMP" line, each a row. */
export function parseCertificationList(text: string, policy: AtsEnginePolicy, now: Date) {
  const items: string[] = [];
  let depth = 0;
  let from = 0;
  for (let at = 0; at < text.length; at += 1) {
    const char = text[at]!;
    if (char === "(" || char === "[") depth += 1;
    else if ((char === ")" || char === "]") && depth > 0) depth -= 1;
    else if (depth === 0 && (char === "," || char === ";" || char === "|")) {
      items.push(text.slice(from, at));
      from = at + 1;
    }
  }
  items.push(text.slice(from));
  return parseCertifications(
    items.filter((item) => item.trim()),
    policy,
    now,
  );
}
