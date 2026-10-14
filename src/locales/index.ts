/**
 * @veriworkly/ats-engine/locales — reading resumes in more than English.
 *
 * Attach the packs to a policy once, where it is loaded; `check` then reads each resume (and
 * posting) in the languages it is written in, and in one region:
 *
 *   const policy = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
 *   check(resume, policy).locale; // { languages: ["de"], region: "DE" }
 *
 * A pack is data — see LOCALES.md for writing one, and the JSON Schemas below for checking it.
 */
import * as z from "zod/mini";

import { de } from "./packs/de.js";
import { fr } from "./packs/fr.js";
import { hi } from "./packs/hi.js";
import { DE, FR, IN, US } from "./packs/regions.js";
import { deepFreeze } from "../util/memo.js";
import { languagePackSchema, regionPackSchema } from "./schema.js";

export { localizePolicy, withLocales, type AtsLocale, type AtsLocaleOptions } from "./resolve.js";
export type {
  AtsLanguagePack,
  AtsLanguagePackInput,
  AtsRegionPack,
  AtsRegionPackInput,
} from "./schema.js";
export { de, fr, hi, DE, FR, IN, US };

/** Every pack this package ships. English is the policy's own base vocabulary, not a pack. */
export const BUILT_IN_LOCALES = /* @__PURE__ */ deepFreeze({
  languages: [de, fr, hi],
  regions: [US, DE, FR, IN],
});

/** JSON Schema for a language pack written as JSON. Patterns are checked when it is attached. */
export const atsLanguagePackJsonSchema = /* @__PURE__ */ deepFreeze(
  /* @__PURE__ */ z.toJSONSchema(languagePackSchema, { io: "input" }),
);
/** JSON Schema for a region pack written as JSON. Patterns are checked when it is attached. */
export const atsRegionPackJsonSchema = /* @__PURE__ */ deepFreeze(
  /* @__PURE__ */ z.toJSONSchema(regionPackSchema, { io: "input" }),
);
