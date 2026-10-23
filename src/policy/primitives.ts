import * as z from "zod/mini";

import { wordListRegex } from "../text/text.js";
import { policyRegex } from "./regex.js";

/** The message `run` throws, or null when it does not throw. */
const failure = (run: () => unknown): string | null => {
  try {
    run();
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

/** Adds a custom issue when the words do not join into one valid alternation. */
function checkAssembles(label: string, words: string[], ctx: z.core.$RefinementCtx) {
  const message = failure(() => wordListRegex(words));
  if (message !== null)
    ctx.addIssue({
      code: "custom",
      message: `${label} does not assemble into a valid regular expression: ${message}`,
    });
}

/**
 * A pattern the engine compiles with `new RegExp`, checked at parse time so a bad one cannot
 * throw mid-request. Compiled in Unicode mode as the engine does (see `policyRegex`); checks
 * that it compiles, not that it is correct.
 */
export const regexString = (label: string) =>
  z.string().check(
    z.minLength(1),
    z.superRefine((pattern, ctx) => {
      const message = failure(() => policyRegex(pattern));
      if (message !== null)
        ctx.addIssue({
          code: "custom",
          message: `${label} is not a valid regular expression in Unicode mode: ${message}`,
        });
    }),
  );

/** Regex flags `new RegExp` accepts. Sticky `y` is refused: it tests one position, not the text. */
export const regexFlags = z._default(z.string(), "").check(
  z.superRefine((flags, ctx) => {
    const message = failure(() => new RegExp("", flags));
    if (message !== null)
      ctx.addIssue({
        code: "custom",
        message: `flags "${flags}" are not valid regular-expression flags: ${message}`,
      });
    else if (flags.includes("y"))
      ctx.addIssue({
        code: "custom",
        message: `flags "${flags}": the sticky flag "y" is not supported`,
      });
  }),
);

/**
 * A rule's pattern compiled with the rule's own flags, as the scorer compiles it: each is valid
 * alone yet the pair can fail (`[(]` is a syntax error under `v`).
 */
export function checkPatternWithFlags(
  rule: { pattern?: string; flags: string },
  ctx: z.core.$RefinementCtx,
) {
  if (!rule.pattern) return;
  const { pattern, flags } = rule;
  const message = failure(() => policyRegex(pattern, flags));
  if (message !== null)
    ctx.addIssue({
      code: "custom",
      path: ["pattern"],
      message: `pattern is not a valid regular expression with flags "${flags}": ${message}`,
    });
}

/**
 * A word list the engine joins with `|` into one unescaped alternation, so entries may be small
 * patterns (`sr\.?`). The check is that the assembled alternation compiles: one stray `c++`
 * would otherwise break every parse.
 */
export const wordList = (label: string) =>
  z.array(z.string().check(z.minLength(1))).check(
    z.minLength(1),
    z.superRefine((words, ctx) => checkAssembles(label, words, ctx)),
  );

/** A Unicode script name, as `\p{Script=…}` reads it: "Devanagari", "Cyrillic". */
export const scriptName = z.string().check(
  z.superRefine((script, ctx) => {
    try {
      new RegExp(`\\p{Script=${script}}`, "u");
    } catch {
      ctx.addIssue({ code: "custom", message: `"${script}" is not a Unicode script name` });
    }
  }),
);

/**
 * A word the matcher compares with lower-cased text: lower-cased here, so "Event Sourcing" in a
 * policy matches as written, and never empty, since "" matches everywhere.
 */
export const term = z.pipe(
  z.string().check(z.minLength(1)),
  z.transform((value) => value.toLowerCase()),
);

/** Credential patterns keyed by ISCED 2011 level; see `resumeParse.degrees`. */
export const iscedDegrees = z.object({
  "2": z.optional(regexString("degrees.2")),
  "3": z.optional(regexString("degrees.3")),
  "4": z.optional(regexString("degrees.4")),
  "5": z.optional(regexString("degrees.5")),
  "6": z.optional(regexString("degrees.6")),
  "7": z.optional(regexString("degrees.7")),
  "8": z.optional(regexString("degrees.8")),
});

export const monthNumber = z.number().check(z.int(), z.gte(1), z.lte(12));

/** A rule's weight: capped, so their sum cannot overflow to Infinity. */
export const ruleWeight = z.number().check(z.gte(0), z.lte(1000));

/** Season name to the first and last month it covers. */
export const seasonRanges = z.record(
  z.string().check(z.minLength(1)),
  z.tuple([monthNumber, monthNumber]),
);

/** The six CEFR levels, lowest first: the order a language requirement is judged in. */
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

/** Level words keyed to the CEFR level each states; the keys assemble like a word list. */
export const cefrLevels = (label: string) =>
  z.record(z.string().check(z.minLength(1)), z.enum(CEFR_LEVELS)).check(
    z.superRefine((levels, ctx) => {
      const words = Object.keys(levels);
      if (words.length) checkAssembles(label, words, ctx);
    }),
  );

/** The words around a certification's dates and issuer; see `resumeParse.credentialWords`. */
export const credentialWords = z.object({
  issued: z._default(wordList("credentialWords.issued"), [
    "issued",
    "obtained",
    "earned",
    "awarded",
    "achieved",
    "completed",
    // A renewal is earned again: "expired 2021, renewed 2023" is held.
    "renewed",
    String.raw`re-?certified`,
  ]),
  expires: z._default(wordList("credentialWords.expires"), [
    "expires",
    "expired",
    "expiry",
    "expiring",
    String.raw`expiration(?:\s+date)?`,
    String.raw`exp\.?`,
    String.raw`valid\s+(?:until|through|thru|till|to)`,
    String.raw`renew(?:s|al)?(?:\s+due)?`,
  ]),
  issuer: z._default(wordList("credentialWords.issuer"), [String.raw`issued\s+by`, "by", "from"]),
  id: z._default(wordList("credentialWords.id"), [
    String.raw`credential(?:\s+id)?`,
    String.raw`(?:certificate|licen[cs]e|registration)\s*(?:id|no\.?|number|#)`,
    "id",
    String.raw`no\.`,
  ]),
});
