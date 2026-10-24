import { escapeRegex, normalizeText } from "../text/text.js";
import type { AtsParsedResume } from "../types.js";

/**
 * Swaps the candidate's contact details for placeholders before a request leaves and back in the
 * reply. Best effort, limited to unambiguous values: what the parser extracted (name, email,
 * phone, links), any email address, the name as "Doe, Jane" or inside a web address built from
 * it, the phone by its national number however dialled, and any other run of 9+ digits opening
 * with "+" or a trunk "0" (date ranges are left alone). Not caught: a postal address, a lone
 * first name, initials, a differently written handle. Replacement is whole-word, and a "name"
 * the parser also read as a job title is left alone.
 */
export type Redaction = {
  /** Replaces contact details in every string inside `value`. */
  apply<T>(value: T): T;
  /** Puts them back. */
  restore<T>(value: T): T;
};

/** Any email address: the parser's `EMAIL` grammar, with a domain and local part in any script and apostrophes. */
const EMAILS =
  /(?<![\p{L}\p{M}\p{N}._%+-]|[\p{L}\p{M}\p{N}]['’])[\p{L}\p{M}\p{N}._%+-][\p{L}\p{M}\p{N}._%+'’-]{0,63}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){0,8}\.\p{L}{2,24}(?![\p{L}\p{N}_])/giu;

/** A web address with or without a scheme ("janedoe.dev", "x.com/janedoe"); bounded labels keep it linear. */
const ADDRESS =
  /(?<![\p{L}\p{N}-])(?:https?:\/\/)?(?:[\p{L}\p{N}-]{1,63}\.){1,8}\p{L}{2,63}(?:\/[^\s|,;()<>]*)?/giu;

/** What may stand between the digits of a phone number: spaces, brackets, dots, any dash. */
const PHONE_GAP = String.raw`[\s().\-/‐‑‒–—]*`;

/**
 * A phone number the parser did not read: 9+ digits on one line opening with "+" or a trunk "0"
 * ("020 7946 0958"), up to three `PHONE_GAP` characters between digits; or a North American
 * number by its shape ("(415) 555-0199", "415-555-0199"). It may follow a label's dot or comma,
 * not a letter, digit, slash, dash or a digit and a dot ("3.0123456789"). Not caught: a number
 * glued to letters, or "+ 44". Linear: gaps never hold a digit and are bounded.
 */
const OTHER_PHONES =
  /(?<![\p{L}\p{N}+_@#=/-]|\p{N}\.)(?:(?:\+|(?=\(?0))\(?\d(?:[ \t().\-/‐‑‒–—]{0,3}\d){8,}|(?:1[-. ])?(?:\(\d{3}\)[ \t]?\d{3}[-. \t]|\d{3}([-.])\d{3}\1)\d{4})(?!\p{N}|[./-]\d)/gu;

/** A month and year, or a day too ("01/2020", "06/15/2019"), after the dash or slash joining it to the previous date. */
const DATE = new RegExp(
  String.raw`(?:[ \t]*[-–—/][ \t]*)?\d{1,2}(?:[./-]\d{1,2})?[ \t]*[./\-–—]?[ \t]*(?:19|20)\d\d`,
  "uy",
);

/**
 * Whether a match is wholly dates, with at most a one- or two-digit figure after them, so a
 * number with a year-like group ("+31 6 2012 3456") is still a number. Linear in the match.
 */
function onlyDates(match: string): boolean {
  let at = match.startsWith("(") ? 1 : 0;
  let dates = 0;
  for (DATE.lastIndex = at; DATE.test(match); DATE.lastIndex = at) {
    dates += 1;
    at = DATE.lastIndex;
  }
  return dates > 0 && /^(?:[ \t().\-/‐‑‒–—]{1,3}\d{1,2})?$/.test(match.slice(at));
}

/**
 * The national number(s) of a phone, each at least seven digits: "+44 20 7946 0958" and
 * "020 7946 0958" are both 2079460958. A trunk "(0)" is dropped (Italy's "+39 06…" keeps its
 * zero); with no break after the code ("+442079460958") one to three digit codes are each tried.
 */
function nationalNumbers(phone: string): string[] {
  const written = phone.replace(/\(0\)/, " ");
  const digits = written.replace(/\D/g, "");
  const code = /^(?:\+|00)[\s(]*(\d{1,3})(?!\d)/.exec(written);
  const numbers = code
    ? [digits.replace(/^00/, "").slice(code[1]!.length)]
    : /^(?:\+|00)/.test(written)
      ? [1, 2, 3]
          .map((length) => digits.replace(/^00/, "").slice(length))
          .filter((n) => n.length >= 9)
      : [digits.replace(/^0+/, ""), digits.replace(/^0+/, "").slice(-10)];
  return [...new Set(numbers)].filter((number) => number.length >= 7);
}

/** Letters and digits only, lower case: how an address spells a name. */
const squash = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** One part of a name, letter by letter: any spacing between, any apostrophe or hyphen. */
const nameLetters = (part: string) =>
  [...part]
    .map((char) =>
      /['‘’ʼ]/.test(char) ? "['‘’ʼ]" : /[-‐‑–]/.test(char) ? "[-‐‑–]" : escapeRegex(char),
    )
    .join(String.raw`\s*`);

/**
 * Whether the parsed name is replaced: one the parser read, not also read as a job title. Two
 * characters are a whole Chinese or Korean name, but too short in Latin script ("Al").
 */
export function redactsName(parsed: Pick<AtsParsedResume, "name" | "roles">): boolean {
  const name = parsed.name.trim();
  return (
    (name.length >= 3 || (name.length === 2 && /[\p{sc=Han}\p{sc=Hangul}]/u.test(name))) &&
    !parsed.roles.some((role) => role.title.trim().toLowerCase() === name.toLowerCase())
  );
}

export function createRedaction(
  parsed: Pick<AtsParsedResume, "name" | "email" | "phone" | "links" | "roles">,
  source: string,
): Redaction {
  const text = normalizeText(source);
  /** Each placeholder, the value it restores to, and the patterns that stand for it. */
  const entries: Array<{ placeholder: string; original: string; patterns: string[] }> = [];

  // One pass of `EMAILS` over the text, not a pattern per address (thousands took seconds).
  // An address only a posting or a reply holds is not the candidate's.
  const emails = new Map<string, string>();
  const restoreEmails: Array<readonly [string, string]> = [];
  for (const email of [parsed.email, ...(text.match(EMAILS) ?? [])]) {
    if (!email || emails.has(email.toLowerCase())) continue;
    const placeholder = `[EMAIL_${emails.size + 1}]`;
    emails.set(email.toLowerCase(), placeholder);
    restoreEmails.push([placeholder, email]);
  }

  const name = parsed.name.trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const named = redactsName(parsed);

  const links = new Set(parsed.links.map((link) => link.trim()).filter((link) => link.length >= 3));
  // An address built from the name identifies the person; five letters at least ("carolina.edu" is not "Li Na").
  const squashedName = squash(name);
  if (named && squashedName.length >= 5)
    for (const [address] of text.matchAll(ADDRESS))
      if (squash(address).includes(squashedName)) links.add(address);
  [...links].forEach((link, index) =>
    entries.push({
      placeholder: `[LINK_${index + 1}]`,
      original: link,
      patterns: [escapeRegex(link)],
    }),
  );

  const phone = parsed.phone.trim();
  if (phone.replace(/\D/g, "").length >= 7) {
    // As written, or as its national number with any separators, after a country code, a trunk
    // zero or a North American "1-". A country code follows "+" or an exit prefix (00, 011, 0011,
    // 010), so a numbered list's "3." is not one.
    const numbers = nationalNumbers(phone).map((number) => [...number].join(PHONE_GAP));
    const prefix = String.raw`(?:(?:\+|00|0011|011|010)${PHONE_GAP}\d{1,3}${PHONE_GAP}(?:0${PHONE_GAP})?|[01]${PHONE_GAP})?`;
    entries.push({
      placeholder: "[PHONE]",
      original: phone,
      patterns: [
        escapeRegex(phone),
        ...(numbers.length ? [String.raw`\(?${prefix}(?:${numbers.join("|")})`] : []),
      ],
    });
  }

  if (named) {
    // Any spacing between letters ("J A N E   D O E"), but a space between the parts: "Tim Ely" is not "timely".
    const first = nameLetters(parts[0]!);
    const last = nameLetters(parts[parts.length - 1]!);
    const patterns = [parts.map(nameLetters).join(String.raw`\s+`)];
    if (parts.length >= 2)
      patterns.push(
        String.raw`${last}\s*,\s*${first}(?:\s+\p{L}\.?)?`, // "Doe, Jane", "Doe, Jane Q."
        String.raw`${first}\s+(?:\p{L}\.?\s+)?${last}`, // with or without a middle initial
      );
    entries.push({ placeholder: "[NAME]", original: name, patterns });
  }

  // Longest original first, so an email or address is replaced before a name it contains.
  const forward = [...entries]
    .sort((a, b) => b.original.length - a.original.length)
    .flatMap(({ placeholder, patterns }) => {
      const [before, after] =
        placeholder === "[NAME]"
          ? [
              String.raw`(?<![\p{L}\p{N}_@./]|[\p{L}\p{N}][-])`,
              // Nor where it begins a longer name: "Jane Doe-Smith" is someone else.
              String.raw`(?![\p{L}\p{N}_@]|[./-][\p{L}\p{N}])`,
            ]
          : placeholder === "[PHONE]"
            ? // An extension may be glued on: "415-555-0132x123".
              [String.raw`(?<![\p{L}\p{N}])`, String.raw`(?!\p{N})`]
            : [String.raw`(?<![\p{L}\p{N}])`, String.raw`(?![\p{L}\p{N}])`];
      return patterns.map(
        (pattern) => [new RegExp(`${before}(?:${pattern})${after}`, "giu"), placeholder] as const,
      );
    });
  const backward = [
    ...restoreEmails,
    ...entries.map(({ placeholder, original }) => [placeholder, original] as const),
  ];

  const deep = (replace: (text: string) => string) => {
    const walk = (node: unknown): unknown => {
      if (typeof node === "string") return replace(node);
      if (Array.isArray(node)) return node.map(walk);
      if (node && typeof node === "object")
        return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
      return node;
    };
    return <T>(value: T) => walk(value) as T;
  };

  // Every other phone number, each with its own placeholder, numbered as first met.
  const others = new Map<string, string>();
  const phones = new Map<string, string>();
  const other = (phone: string) => {
    if (onlyDates(phone)) return phone;
    if (!others.has(phone)) {
      others.set(phone, `[PHONE_${others.size + 1}]`);
      phones.set(others.get(phone)!, phone);
    }
    return others.get(phone)!;
  };

  return {
    // Addresses first, so a name or a link inside one is not replaced into it.
    apply: deep((text) =>
      forward
        .reduce(
          (out, [pattern, to]) => out.replace(pattern, to),
          normalizeText(text).replace(EMAILS, (email) => emails.get(email.toLowerCase()) ?? email),
        )
        .replace(OTHER_PHONES, other),
    ),
    // Placeholders are unique bracketed tokens, so restoring them needs no boundaries.
    restore: deep((text) =>
      backward
        .reduce((out, [from, to]) => out.split(from).join(to), text)
        .replace(/\[PHONE_\d+\]/g, (placeholder) => phones.get(placeholder) ?? placeholder),
    ),
  };
}
