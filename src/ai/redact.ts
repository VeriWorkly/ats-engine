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
 * is replaced. The phone number is caught by its digits whatever separates them, but phone-shaped
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

/** A web address with or without a scheme: "janedoe.dev", "x.com/janedoe", "https://…". */
const ADDRESS = /(?:https?:\/\/)?(?:[\p{L}\p{N}-]+\.)+\p{L}{2,}(?:\/[^\s|,;()<>]*)?/giu;

/** What may stand between the digits of a phone number. */
const PHONE_GAP = String.raw`[\s().\-/]*`;

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

  const digits = parsed.phone.replace(/\D/g, "");
  if (digits.length >= 7) {
    // As the parser read it, or with other separators ("415.555.0199"), with or without the
    // country code.
    const national = [...digits.slice(-10)].join(PHONE_GAP);
    entries.push({
      placeholder: "[PHONE]",
      original: parsed.phone.trim(),
      patterns: [
        escapeRegex(parsed.phone.trim()),
        String.raw`(?:\+?\d{1,3}${PHONE_GAP})?\(?` + national,
      ],
    });
  }

  if (named) {
    // Any spacing between letters, as a letter-spaced header ("J A N E   D O E") extracts.
    const first = nameLetters(parts[0]!);
    const last = nameLetters(parts[parts.length - 1]!);
    const patterns = [parts.map(nameLetters).join(String.raw`\s*`)];
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
