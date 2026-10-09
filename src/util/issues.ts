import { config, type core } from "zod/mini";
import en from "zod/v4/locales/en.js";

const english = en().localeError;

/**
 * Parse options that word zod's issues in English, for every `safeParse` whose messages reach a
 * caller (`AtsPolicyError`, `AtsInputError`, `AtsAiError`).
 *
 * The schemas are written with `zod/mini`, which ships no locale: alone it says "Invalid input"
 * for everything. Full `zod` installs English as the default locale; this does the same per parse
 * instead of globally, so the messages are the ones `zod` gives ("Too small: expected array to
 * have >=1 items"). A locale or error map the host set on zod itself still wins, as it does there.
 */
export const ENGLISH_ISSUES: core.ParseContext<core.$ZodIssue> = {
  error: (issue) => {
    const { customError, localeError } = config();
    return customError || localeError ? undefined : english(issue);
  },
};
