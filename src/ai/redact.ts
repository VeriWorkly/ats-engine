import { escapeRegex, normalizeText } from "../text/text.js";
import { EMAIL } from "../parser/contact.js";
import type { AtsParsedResume } from "../types.js";

/**
 * Contact-detail redaction for tasks that do not need to know who the candidate is.
 *
 * Analysis judges the content of a resume; the candidate's name, email, phone number and links
 * add nothing to it and are the details least worth handing to a third party. (A postal address
 * is not recognised, so it is not redacted.) They are swapped for
 * placeholders before the request leaves and swapped back in the reply, so a recommendation that
 * mentions them still reads correctly.
 *
 * Best effort by design, and limited to values that are unambiguous: what the parser extracted
 * (name, email, phone, links) plus any further email address, whose grammar cannot be confused
 * with anything else. The name is also caught as "Doe, Jane", with or without a middle initial,
 * and inside a web address built from it ("janedoe.dev", "x.com/janedoe"), where the whole address
 * is replaced. The phone number is caught by its national number whatever separates its digits and
 * however it is dialled ("+44 20…", "0044 20…", "020…"), but phone-shaped
 * digit runs in general are *not* swept — "2019 - 2023" has the shape of a phone number. A first
 * name used on its own elsewhere in the text is not caught. Replacement is whole-word, so a
 * three-letter name does not rewrite the inside of another word, and a "name" the parser also read
 * as a job title is left alone — swapping a title for [NAME] would cost the analysis more than it
 * hides. Tasks that must recover these values (parse repair, conversion) do not redact at all.
 */
export type Redaction = {
  /** Replaces contact details in every string inside `value`. */
  apply<T>(value: T): T;
  /** Puts them back. */
  restore<T>(value: T): T;
};

const EMAILS = new RegExp(EMAIL.source, "gi");

/**
 * A web address with or without a scheme: "janedoe.dev", "x.com/janedoe", "https://…".
 *
 * Linear: a match starts only where a label starts, and a host is at most eight labels of at most
 * 63 characters (DNS allows no longer label), so each start reads a bounded stretch. Unbounded,
 * every letter of "aaaa…" or "a.a.a.…" started a scan to the end of the run: 150,000 characters
 * took 50 seconds.
 */
const ADDRESS =
  /(?<![\p{L}\p{N}-])(?:https?:\/\/)?(?:[\p{L}\p{N}-]{1,63}\.){1,8}\p{L}{2,63}(?:\/[^\s|,;()<>]*)?/giu;

/** What may stand between the digits of a phone number: spaces, brackets, dots, any dash. */
const PHONE_GAP = String.raw`[\s().\-/‐‑‒–—]*`;

/**
 * The digits that may name the line wherever it is dialled from (its national number), longest
 * first, each at least seven. "+44 20 7946 0958" and "020 7946 0958" are both 2079460958. A
 * number written with its country code ("+44", "0044") is that many digits without a code of
 * one, two or three digits, so no table of codes is needed; a trunk "(0)" is dropped (Italy's
 * leading zero is part of the number and stays: "+39 06…" is 06…). A number written nationally
 * loses its trunk zeros, and ten digits at most cover a North American "1-".
 */
function nationalNumbers(phone: string): string[] {
  const digits = phone.replace(/\(0\)/, "").replace(/\D/g, "");
  const numbers = /^(?:\+|00)/.test(phone)
    ? [0, 1, 2, 3].map((code) => digits.replace(/^00/, "").slice(code))
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

export function createRedaction(
  parsed: Pick<AtsParsedResume, "name" | "email" | "phone" | "links" | "roles">,
  source: string,
): Redaction {
  const text = normalizeText(source);
  /** Each placeholder, the value it restores to, and the patterns that stand for it. */
  const entries: Array<{ placeholder: string; original: string; patterns: string[] }> = [];

  const emails = new Set([parsed.email, ...(text.match(EMAILS) ?? [])].filter(Boolean));
  [...emails].forEach((email, index) =>
    entries.push({
      placeholder: `[EMAIL_${index + 1}]`,
      original: email,
      patterns: [escapeRegex(email)],
    }),
  );

  const name = parsed.name.trim();
  const parts = name.split(/\s+/).filter(Boolean);
  const named =
    name.length >= 3 &&
    !parsed.roles.some((role) => role.title.trim().toLowerCase() === name.toLowerCase());

  const links = new Set(parsed.links.map((link) => link.trim()).filter((link) => link.length >= 3));
  // An address built from the name names the person as surely as the name does. Five letters at
  // least, so a short name does not take "carolina.edu" for "Li Na".
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
    // As the parser read it, or as its national number with any separators ("415.555.0199",
    // "020–7946–0958"), after a country code ("+44", "0044", "+44 (0)"), a trunk zero ("020",
    // "(020)") or a North American "1-". A country code starts with "+" or "00", so the "3." of a
    // numbered list is not one. Linear: each digit is a literal, the gaps between them never hold
    // a digit, and there are at most four numbers to try.
    const numbers = nationalNumbers(phone).map((number) => [...number].join(PHONE_GAP));
    const prefix = String.raw`(?:(?:\+|00)${PHONE_GAP}\d{1,3}${PHONE_GAP}(?:0${PHONE_GAP})?|[01]${PHONE_GAP})?`;
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
    // Any spacing between letters, as a letter-spaced header ("J A N E   D O E") extracts, but a
    // space between the parts: "Tim Ely" is not "timely".
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

  // Longest original first, so an email or an address is replaced before a name it contains.
  // Case-insensitive, on text normalised as the engine reads it (no-break spaces, soft hyphens,
  // ligatures). A name glued into an address that was not caught is left whole rather than cut
  // into "[NAME].dev".
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
          : [String.raw`(?<![\p{L}\p{N}])`, String.raw`(?![\p{L}\p{N}])`];
      return patterns.map(
        (pattern) => [new RegExp(`${before}(?:${pattern})${after}`, "giu"), placeholder] as const,
      );
    });
  const backward = entries.map(({ placeholder, original }) => [placeholder, original] as const);

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

  return {
    apply: deep((text) =>
      forward.reduce((out, [pattern, to]) => out.replace(pattern, to), normalizeText(text)),
    ),
    // Placeholders are unique bracketed tokens, so restoring them needs no boundaries.
    restore: deep((text) => backward.reduce((out, [from, to]) => out.split(from).join(to), text)),
  };
}
