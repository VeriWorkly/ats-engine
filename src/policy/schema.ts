import * as z from "zod/mini";

import { languagePackSchema, regionPackSchema } from "../locales/schema.js";
import { adviceSchema } from "./schema/advice.js";
import { keywordMatchSchema } from "./schema/keywordMatch.js";
import { resumeParseSchema } from "./schema/resumeParse.js";
import { ruleSchema } from "./schema/rules.js";
import { engineTextSchema } from "./schema/text.js";
import { writingSchema } from "./schema/writing.js";

/**
 * Locale packs attached to the policy (see `withLocales`). The policy's vocabulary is the base;
 * a language pack joins it only for text detected in that language, and one region pack applies
 * per resume.
 */
const localesSchema = z.prefault(
  z.object({
    languages: z._default(z.array(languagePackSchema), []),
    regions: z._default(z.array(regionPackSchema), []),
  }),
  {},
);

/** Whether two ids differ only in case or by at most two edits: one is a typo of the other. */
function typoOf(id: string, of: string) {
  if (id.toLowerCase() === of.toLowerCase()) return true;
  if (Math.abs(id.length - of.length) > 2 || id.length > 200) return false;
  let previous = Array.from({ length: of.length + 1 }, (_, j) => j);
  for (let i = 1; i <= id.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= of.length; j += 1)
      row[j] = Math.min(
        previous[j]! + 1,
        row[j - 1]! + 1,
        previous[j - 1]! + (id[i - 1] === of[j - 1] ? 0 : 1),
      );
    previous = row;
  }
  return previous[of.length]! <= 2;
}

export const atsEngineSchema = z
  .object({
    version: z.string().check(z.minLength(1)),
    // Unique ids: a region pack adjusts rules by id, and would adjust every rule sharing one.
    rules: z.array(ruleSchema).check(
      z.minLength(1),
      z.superRefine((rules, ctx) => {
        const seen = new Set<string>();
        rules.forEach((rule, index) => {
          if (seen.has(rule.id))
            ctx.addIssue({
              code: "custom",
              path: [index, "id"],
              message: `rule id "${rule.id}" is used by more than one rule`,
            });
          seen.add(rule.id);
        });
      }),
    ),
    keywordMatch: keywordMatchSchema,
    resumeParse: resumeParseSchema,
    text: engineTextSchema,
    writing: writingSchema,
    advice: adviceSchema,
    locales: localesSchema,
  })
  .check(
    // A region's change to a rule the policy lacks is ignored: a built-in region names rules a
    // host's own policy may leave out. One a typo away from a rule the policy has is refused,
    // since it would be dropped silently.
    z.superRefine((policy, ctx) => {
      const ids = policy.rules.map((rule) => rule.id);
      policy.locales.regions.forEach((region, index) => {
        for (const id of Object.keys(region.rules)) {
          const meant = ids.includes(id) ? undefined : ids.find((other) => typoOf(id, other));
          if (meant)
            ctx.addIssue({
              code: "custom",
              path: ["locales", "regions", index, "rules", id],
              message: `the policy has no rule with id "${id}"; did you mean "${meant}"?`,
            });
        }
      });
    }),
  );

/** One rule of a validated policy: what it reads, what it weighs, and what it says. */
export type AtsEngineRule = z.infer<typeof ruleSchema>;
/** A validated policy, with every default applied. What the engine reads. */
export type AtsEnginePolicy = z.infer<typeof atsEngineSchema>;
/** A policy as an author writes it: fields with defaults may be omitted. What `parseAtsPolicy` takes. */
export type AtsEnginePolicyInput = z.input<typeof atsEngineSchema>;
