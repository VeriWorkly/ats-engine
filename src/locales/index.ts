/**
 * @veriworkly/ats-engine/locales: attach packs to a policy once, then `check` reads each resume
 * in the languages and region it is written in.
 *
 *   const policy = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);
 *   check(resume, policy).locale; // { languages: ["de"], region: "DE" }
 *
 * A pack is data: see LOCALES.md, and the JSON Schemas below.
 */
import * as z from "zod/mini";

import { de } from "./packs/de.js";
import { es } from "./packs/es.js";
import { fr } from "./packs/fr.js";
import { hi } from "./packs/hi.js";
import { pt } from "./packs/pt.js";
import { BR, DE, ES, FR, GB, IN, PT, US } from "./packs/regions.js";
import { deepFreeze } from "../util/memo.js";
import { languagePackSchema, regionPackSchema } from "./schema.js";

export { localizePolicy, withLocales, type AtsLocale, type AtsLocaleOptions } from "./resolve.js";
export type {
  AtsLanguagePack,
  AtsLanguagePackInput,
  AtsRegionPack,
  AtsRegionPackInput,
} from "./schema.js";
export { de, es, fr, hi, pt, BR, DE, ES, FR, GB, IN, PT, US };

/** Every pack this package ships. English is the policy's own base vocabulary, not a pack. */
export const BUILT_IN_LOCALES = /* @__PURE__ */ deepFreeze({
  languages: [de, fr, hi, es, pt],
  regions: [US, DE, FR, GB, IN, ES, BR, PT],
});

/** JSON Schema for a language pack written as JSON. Patterns are checked when it is attached. */
export const atsLanguagePackJsonSchema = /* @__PURE__ */ deepFreeze(
  /* @__PURE__ */ z.toJSONSchema(languagePackSchema, { io: "input" }),
);
/** JSON Schema for a region pack written as JSON. Patterns are checked when it is attached. */
export const atsRegionPackJsonSchema = /* @__PURE__ */ deepFreeze(
  /* @__PURE__ */ z.toJSONSchema(regionPackSchema, { io: "input" }),
);
