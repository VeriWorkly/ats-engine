import { AtsPolicyError } from "../policy/errors.js";
import { parseAtsPolicy } from "../policy/parse.js";
import type { AtsEnginePolicy, AtsEnginePolicyInput, AtsEngineRule } from "../policy/schema.js";
import { phoneCountry } from "../parser/phone.js";
import { memo } from "../util/memo.js";
import { own } from "../util/own.js";
import { applyVocabulary, DETECTION_SAMPLE, isWrittenIn, sampleOf, union } from "./languages.js";
import type { AtsLanguagePackInput, AtsRegionPack, AtsRegionPackInput } from "./schema.js";

/**
 * Attaches locale packs to a policy, validating them with it. Packs with an id the policy
 * already has replace that pack. Call once, where the policy is loaded; the result is an
 * ordinary policy to pass to `check`.
 */
export function withLocales(
  policy: AtsEnginePolicyInput,
  packs: { languages?: AtsLanguagePackInput[]; regions?: AtsRegionPackInput[] },
): AtsEnginePolicy {
  const byId = <T extends { id: string }>(existing: T[] = [], added: T[] = []) => [
    ...new Map([...existing, ...added].map((pack) => [pack.id, pack])).values(),
  ];
  const attached = parseAtsPolicy({
    ...policy,
    locales: {
      languages: byId(policy.locales?.languages, packs.languages),
      regions: byId(policy.locales?.regions, packs.regions),
    },
  });
  assertCombinable(attached);
  return attached;
}

/**
 * Each pack's patterns are valid alone, yet joined to the base's as alternatives they can still
 * fail to compile — a named group the base and a pack both use is a duplicate — and would then
 * throw on the first resume read in that language. So the combinations `check` can build are
 * compiled here, through the same schema: every language pack at once, with each region in turn.
 * A clash between any packs that can apply together shows up in one of those.
 */
function assertCombinable(policy: AtsEnginePolicy) {
  const { languages, regions } = policy.locales;
  if (!languages.length && !regions.length) return;
  const allLanguages = languages.reduce(applyVocabulary, policy);
  for (const region of regions.length ? regions : [undefined]) {
    const combined = region ? applyRegion(allLanguages, region) : allLanguages;
    try {
      parseAtsPolicy({ ...combined, locales: undefined });
    } catch (error) {
      if (!(error instanceof AtsPolicyError)) throw error;
      const ids = [...languages.map((pack) => pack.id), ...(region ? [region.id] : [])];
      throw new AtsPolicyError(
        `Locale packs ${ids.join(", ")} combine with the policy into an invalid one.`,
        error.issues,
      );
    }
  }
}

/**
 * A rule as a region weighs it, or null when the region turns it off (`weight: 0`). Off, not
 * passed: a date-of-birth rule weighted to nothing would otherwise report "no date of birth is
 * stated" about a resume that states one.
 */
function adjustRule(
  rule: AtsEngineRule,
  change: AtsRegionPack["rules"][string] | undefined,
): AtsEngineRule | null {
  if (!change) return rule;
  if (change.weight === 0) return null;
  const adjusted = change.severity ? { ...rule, severity: change.severity } : { ...rule };
  const { weight } = change;
  if (weight === undefined) return adjusted;
  if ("bands" in adjusted)
    return {
      ...adjusted,
      bands: adjusted.bands.map((band) => (band.weight > 0 ? { ...band, weight } : band)),
    };
  return { ...adjusted, weight };
}

function applyRegion(policy: AtsEnginePolicy, region: AtsRegionPack): AtsEnginePolicy {
  const localized = applyVocabulary(policy, region);
  return {
    ...localized,
    rules: localized.rules
      .map((rule) => adjustRule(rule, own(region.rules, rule.id)))
      .filter((rule): rule is AtsEngineRule => rule !== null),
    resumeParse: {
      ...localized.resumeParse,
      dateOrder: region.dateOrder,
      phoneRegions: union([region.phoneCountry], localized.resumeParse.phoneRegions),
    },
    ...(region.ageAdvice && {
      advice: {
        ...localized.advice,
        age: { ...localized.advice.age, ...region.ageAdvice },
      },
    }),
  };
}

/** What `check` read a resume as. Packs are named by id; the policy's base vocabulary is not. */
export type AtsLocale = { languages: string[]; region: string | null };

/** Set the languages and the region a resume is read in, instead of detecting them. */
export type AtsLocaleOptions = {
  /** Language pack ids to read with, instead of detecting them. `[]` reads with the base only. */
  languages?: string[];
  /** The region pack id to apply (any case), instead of inferring one; unknown ids throw. */
  region?: string;
};

/** Per base policy: every language, region and date-order combination it has been localised to. */
const localizedOf = memo<AtsEnginePolicy, Map<string, AtsEnginePolicy>>(() => new Map());

const FULL_DATE = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-]\d{4}(?!\d)/g;

/**
 * How the resume orders an all-numeric date, when its own dates settle it: "15/07/2015" can only
 * be day-first, "07/15/2015" only month-first. Undefined when none settles it or they disagree.
 * The country's convention is a guess; a resume that writes a 15th of the month is not.
 */
function dateOrderIn(text: string): "DMY" | "MDY" | undefined {
  let dayFirst = false;
  let monthFirst = false;
  for (const [, first, second] of text.matchAll(FULL_DATE)) {
    if (Number(first) > 12 && Number(second) <= 12) dayFirst = true;
    else if (Number(second) > 12 && Number(first) <= 12) monthFirst = true;
  }
  return dayFirst === monthFirst ? undefined : dayFirst ? "DMY" : "MDY";
}

/**
 * The policy a given resume (and posting) is scored with: the base, plus the attached language
 * packs it is written in, plus one region, plus the date order the resume's own dates show.
 *
 * The region is the one asked for; failing that the country of the first phone number written
 * with a country code; failing that the default region of a language the resume itself is
 * written in (or of a language asked for). Memoised per
 * combination, so every resume read as German shares one compiled policy.
 */
export function localizePolicy(
  policy: AtsEnginePolicy,
  text: string,
  options: AtsLocaleOptions = {},
  /** The resume alone, without a posting: what names the region and the date order. */
  resumeText = text,
): {
  policy: AtsEnginePolicy;
  locale: AtsLocale;
  /**
   * The language packs the resume itself is read in — those asked for, else those it is detected
   * as written in — leaving out a language only the posting is written in. Empty for the base.
   */
  resumeLanguages: string[];
} {
  const { languages: packs, regions } = policy.locales;
  // A region asked for by name is applied or refused, never dropped: ignoring it would also skip
  // the inference from the phone number, and score the resume under no region without a word.
  const asked = options.region
    ? regions.find((pack) => pack.id === options.region!.toUpperCase())
    : undefined;
  if (options.region && !asked) {
    const attached = regions.map((pack) => pack.id).join(", ") || "none";
    throw new AtsPolicyError(
      `Region "${options.region}" is not attached to the policy (attached: ${attached}).`,
      [{ path: "locales.regions", message: `no region pack with id "${options.region}"` }],
    );
  }
  const dateOrder = dateOrderIn(resumeText.slice(0, DETECTION_SAMPLE));
  if (packs.length === 0 && regions.length === 0 && dateOrder === undefined)
    return { policy, locale: { languages: [], region: null }, resumeLanguages: [] };

  // The resume and the posting are detected apart, each in its own language: measured together,
  // a long English posting dilutes a German resume below the share that recognises it.
  const posting =
    text === resumeText ? "" : text.startsWith(resumeText) ? text.slice(resumeText.length) : text;
  const resumeSample = sampleOf(resumeText);
  const postingSample = posting ? sampleOf(posting) : undefined;
  const inResume = packs.filter((pack) => isWrittenIn(resumeSample, pack));
  const languages = options.languages
    ? packs.filter((pack) => options.languages!.includes(pack.id))
    : packs.filter(
        (pack) =>
          inResume.includes(pack) ||
          (postingSample !== undefined && isWrittenIn(postingSample, pack)),
      );

  // A language only the posting is written in says where the job is, not how the resume writes
  // its dates: a US resume applying to a German posting keeps month-first dates.
  const country = asked ? undefined : phoneCountry(resumeText.slice(0, DETECTION_SAMPLE));
  const region =
    asked ??
    regions.find((pack) => pack.phoneCountry === country) ??
    (options.languages ? languages : inResume)
      .map((pack) => regions.find((candidate) => candidate.id === pack.defaultRegion))
      .find(Boolean);

  const locale: AtsLocale = {
    languages: languages.map((pack) => pack.id),
    region: region?.id ?? null,
  };
  const key = `${locale.languages.join("+")}|${locale.region ?? ""}|${dateOrder ?? ""}`;

  const cached = localizedOf(policy);
  let localized = cached.get(key);
  if (!localized) {
    localized = languages.reduce(applyVocabulary, policy);
    if (region) localized = applyRegion(localized, region);
    // With no region known, a national number is still recovered if any attached region reads
    // it. The region is not inferred from that: the "min" metadata takes nearly any 10-digit run
    // as a valid German or Indian number, US ones included, so validity cannot name a country.
    else if (regions.length)
      localized = {
        ...localized,
        resumeParse: {
          ...localized.resumeParse,
          phoneRegions: union(
            localized.resumeParse.phoneRegions,
            regions.map((pack) => pack.phoneCountry),
          ),
        },
      };
    if (dateOrder)
      localized = { ...localized, resumeParse: { ...localized.resumeParse, dateOrder } };
    cached.set(key, localized);
  }
  const resumeLanguages = (options.languages ? languages : inResume).map((pack) => pack.id);
  return { policy: localized, locale, resumeLanguages };
}
