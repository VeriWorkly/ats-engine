import { DEFAULT_KEYWORD_MATCH } from "./default/keywordMatch.js";
import { DEFAULT_RESUME_PARSE } from "./default/resumeParse.js";
import { DEFAULT_RULES } from "./default/rules.js";
import { parseAtsPolicy } from "./parse.js";
import type { AtsEnginePolicy } from "./schema.js";

/**
 * A minimal, generic policy: the smallest one that exercises every rule kind and vocabulary, so
 * the package is usable and testable on its own. Not the curated production taxonomy. Fields the
 * schema defaults are left to it.
 */
const DEFAULT_POLICY_JSON = {
  version: "ats-v2",
  rules: DEFAULT_RULES,
  keywordMatch: DEFAULT_KEYWORD_MATCH,
  resumeParse: DEFAULT_RESUME_PARSE,
};

/** Validated at module load, so a mistake in the default fails this package's own build. */
export const DEFAULT_POLICY: AtsEnginePolicy = parseAtsPolicy(DEFAULT_POLICY_JSON);
