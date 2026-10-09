import * as z from "zod/mini";

import { wordListRegex } from "../text/text.js";
import { policyRegex } from "./regex.js";

/**
 * A string the engine will hand to `new RegExp`, checked here rather than at match time.
 *
 * Without this a policy that satisfies every other constraint still throws `SyntaxError` on the
 * first request that evaluates the rule — which is the exact failure the boot-time validation
 * exists to prevent: a process that reports itself healthy while an endpoint 500s. The pattern is
 * operator-supplied and never reaches a caller, so naming the offending field in the issue is
 * safe and is the only way to debug a file the process cannot show you.
 *
 * Compiled in Unicode mode, as the engine compiles it (see `policyRegex`): that is where an
 * escape a pattern written for the old non-Unicode engine relied on (`\-` outside a class) fails.
 *
 * Compilation only. It says nothing about whether the pattern is *correct* — that is what the
 * calibration suite is for.
 */
export const regexString = (label: string) =>
  z.string().check(
    z.minLength(1),
    z.superRefine((pattern, ctx) => {
      try {
        policyRegex(pattern);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message: `${label} is not a valid regular expression in Unicode mode: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }),
  );

/**
 * Regex flags, which `new RegExp` rejects just as loudly as a malformed pattern — an unknown
 * letter or a repeated one is a `SyntaxError`, so it is validated in the same place.
 *
 * `y` (sticky) compiles but tests one position only — wherever the last match left off — so a
 * rule carrying it passes or fails at random rather than reading the text; it is refused.
 */
export const regexFlags = z._default(z.string(), "").check(
  z.superRefine((flags, ctx) => {
    try {
      new RegExp("", flags);
    } catch (error) {
      ctx.addIssue({
        code: "custom",
        message: `flags "${flags}" are not valid regular-expression flags: ${
          error instanceof Error ? error.message : String(error)
        }`,
      });
      return;
    }
    if (flags.includes("y"))
      ctx.addIssue({
        code: "custom",
        message: `flags "${flags}": the sticky flag "y" is not supported`,
      });
  }),
);

/**
 * A rule's pattern compiled with the rule's own flags, as the scorer compiles it. Each is valid
 * alone yet the pair can still fail: `[(]` is a class in Unicode mode and a syntax error under
 * `v`. Added to the rule object, since neither field sees the other.
 */
export function checkPatternWithFlags(
  rule: { pattern?: string; flags: string },
  ctx: z.core.$RefinementCtx,
) {
  if (!rule.pattern) return;
  try {
    policyRegex(rule.pattern, rule.flags);
  } catch (error) {
    ctx.addIssue({
      code: "custom",
      path: ["pattern"],
      message: `pattern is not a valid regular expression with flags "${rule.flags}": ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
}

/**
 * A word list the engine joins with `|` into one alternation, unescaped.
 *
 * That makes a metacharacter in any single entry a failure of the *whole* pattern, not just of
 * that word: `c++` in `titleWords` raises "Nothing to repeat" and takes down every parse. The
 * entries are deliberately not escaped at use — a policy author can legitimately write a small
 * pattern like `sr\.?` — so the check is that the assembled alternation compiles, which is the
 * thing that actually has to hold.
 */
export const wordList = (label: string) =>
  z.array(z.string().check(z.minLength(1))).check(
    z.minLength(1),
    z.superRefine((words, ctx) => {
      try {
        wordListRegex(words);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message: `${label} does not assemble into a valid regular expression: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
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

export type IscedDegrees = z.output<typeof iscedDegrees>;

/** The six CEFR levels, lowest first: the order a language requirement is judged in. */
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;

/**
 * Level words keyed to the CEFR level each states. The keys are joined into one alternation, as
 * a word list is, so they are checked the same way: the assembled pattern must compile.
 */
export const cefrLevels = (label: string) =>
  z.record(z.string().check(z.minLength(1)), z.enum(CEFR_LEVELS)).check(
    z.superRefine((levels, ctx) => {
      const words = Object.keys(levels);
      if (!words.length) return;
      try {
        wordListRegex(words);
      } catch (error) {
        ctx.addIssue({
          code: "custom",
          message: `${label} does not assemble into a valid regular expression: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
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
