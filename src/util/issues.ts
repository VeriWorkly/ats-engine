import { config, type core } from "zod/mini";
import en from "zod/v4/locales/en.js";

const english = en().localeError;

/**
 * Parse options that word zod's issues in English. `zod/mini` ships no locale and would say
 * "Invalid input" for everything; this installs English per parse, not globally. A locale or
 * error map the host set on zod itself still wins.
 */
export const ENGLISH_ISSUES: core.ParseContext<core.$ZodIssue> = {
  error: (issue) => {
    const { customError, localeError } = config();
    return customError || localeError ? undefined : english(issue);
  },
};
