import type { AtsParsedField, AtsParsedResume, AtsProvenance } from "../types.js";
import { highestIsced } from "./education.js";
import { monthsOfExperience } from "./tenure.js";

/** The recovered values themselves; everything else in `AtsParsedResume` is derived from them. */
export type ParsedCore = Omit<
  AtsParsedResume,
  "monthsOfExperience" | "highestIsced" | "provenance"
>;

const PARSED_FIELDS: readonly AtsParsedField[] = [
  "name",
  "email",
  "phone",
  "roles",
  "education",
  "skills",
  "certifications",
  "spokenLanguages",
];

const MAX_REPORTED = {
  roles: 20,
  education: 10,
  skills: 60,
  links: 10,
  certifications: 20,
  spokenLanguages: 15,
};

/**
 * Caps the lists, derives tenure and highest degree, and stamps provenance. Every producer of a
 * parsed record (text parser, document reader, repair merge) goes through here, so derived fields
 * cannot disagree with their values. An empty field is `none` whatever `sourceOf` says.
 */
export function finalizeParsed(
  core: ParsedCore,
  sourceOf: (field: AtsParsedField) => AtsProvenance,
  now: Date,
): AtsParsedResume {
  const capped: ParsedCore = {
    name: core.name,
    email: core.email,
    phone: core.phone,
    links: [...new Set(core.links)].slice(0, MAX_REPORTED.links),
    roles: core.roles.slice(0, MAX_REPORTED.roles),
    education: core.education.slice(0, MAX_REPORTED.education),
    skills: [...new Set(core.skills)].slice(0, MAX_REPORTED.skills),
    // A record handed back by a caller may lack these.
    certifications: (core.certifications ?? []).slice(0, MAX_REPORTED.certifications),
    spokenLanguages: (core.spokenLanguages ?? []).slice(0, MAX_REPORTED.spokenLanguages),
  };

  const provenance = {} as Record<AtsParsedField, AtsProvenance>;
  for (const field of PARSED_FIELDS)
    provenance[field] = capped[field].length > 0 ? sourceOf(field) : "none";

  return {
    ...capped,
    // Tenure counts every recovered role, not only the capped ones.
    monthsOfExperience: monthsOfExperience(core.roles, now),
    highestIsced: highestIsced(core.education),
    provenance,
  };
}
