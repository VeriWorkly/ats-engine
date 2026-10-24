import { AtsPolicyError } from "../policy/errors.js";
import { parseAtsPolicy } from "../policy/parse.js";
import type { AtsEnginePolicy, AtsEnginePolicyInput, AtsEngineRule } from "../policy/schema.js";
import { phoneCountry } from "../parser/phone.js";
import { BULLET } from "../text/text.js";
import { deepFreeze, memo } from "../util/memo.js";
import { own } from "../util/own.js";
import {
  applyVocabulary,
  DETECTION_SAMPLE,
  isWrittenIn,
  otherLanguageOf,
  outweighs,
  sampleOf,
  union,
  UNDETERMINED,
} from "./languages.js";
import type { AtsLanguagePackInput, AtsRegionPack, AtsRegionPackInput } from "./schema.js";

/**
 * Attaches locale packs to a policy, validating them with it. Packs with an id the policy
 * already has replace that pack. Call once, where the policy is loaded; the result is an
 * ordinary policy to pass to `check`.
 */
export function withLocales(
  policy: AtsEnginePolicyInput,
  packs: {
    languages?: AtsLanguagePackInput[] | undefined;
    regions?: AtsRegionPackInput[] | undefined;
  },
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
 * Patterns valid alone can fail once joined as alternatives (a named group used by the base and a
 * pack). So the combinations `check` can build, every language pack at once with each region in
 * turn, are compiled here through the schema.
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

/** A rule as a region weighs it, or null when the region turns it off (`weight: 0`). */
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

/** The error for a region or language a call names that the policy has no pack for. */
function notAttached(kind: "region" | "language", id: string, packs: { id: string }[]) {
  const attached = packs.map((pack) => pack.id).join(", ") || "none";
  const label = kind[0]!.toUpperCase() + kind.slice(1);
  return new AtsPolicyError(
    `${label} "${id}" is not attached to the policy (attached: ${attached}).`,
    [{ path: `locales.${kind}s`, message: `no ${kind} pack with id "${id}"` }],
  );
}

/** What `check` read a resume as. Packs are named by id; the policy's base vocabulary is not. */
export type AtsLocale = {
  languages: string[];
  region: string | null;
  /**
   * The language the resume is written in when the policy recognises it (`text.otherLanguages`)
   * and no pack read here is that language: an ISO 639 code ("it"), a script ("Cyrillic"), or
   * "und" for an entry with neither. It was read with the base vocabulary, and rules limited to
   * some `languages` were dropped. Null otherwise.
   */
  unsupported: string | null;
};

/** Set the languages and the region a resume is read in, instead of detecting them. */
export type AtsLocaleOptions = {
  /**
   * Language pack ids to read with, instead of detecting them, in any case. `[]`, or the policy's
   * own language, reads with the base only; an id no attached pack has throws `AtsPolicyError`.
   */
  languages?: string[] | undefined;
  /** The region pack id to apply (any case), instead of inferring one; unknown ids throw. */
  region?: string | undefined;
};

/** Per base policy: every language, region and date-order combination it has been localised to. */
const localizedOf = memo<AtsEnginePolicy, Map<string, AtsEnginePolicy>>(() => new Map());

const FULL_DATE = /(?<!\d)(\d{1,2})[./-](\d{1,2})[./-]\d{4}(?!\d)/g;

/** The order a resume's own all-numeric dates settle ("15/07/2015" is day-first), else undefined. */
function dateOrderIn(text: string): "DMY" | "MDY" | undefined {
  let dayFirst = false;
  let monthFirst = false;
  for (const [, first, second] of text.matchAll(FULL_DATE)) {
    if (Number(first) > 12 && Number(second) <= 12) dayFirst = true;
    else if (Number(second) > 12 && Number(first) <= 12) monthFirst = true;
  }
  return dayFirst === monthFirst ? undefined : dayFirst ? "DMY" : "MDY";
}

/** Without accents: "Bogotá" and "Bogota" alike. */
const plain = (text: string) => text.normalize("NFD").replace(/\p{M}/gu, "");
/** A region's name and cities, matched whole, ignoring case and accents. */
const placesOfRegion = memo(
  (region: AtsRegionPack) =>
    new RegExp(`^(?:${[region.name, ...(region.cityNames ?? [])].map(plain).join("|")})$`, "iu"),
);
/** The country domain of an email or a site: "ar" in "@empresa.com.ar"; ".co" alone is a startup's. */
const COUNTRY_DOMAIN =
  /[@.][a-z0-9-]{1,63}\.(?:(?:com|org|edu|gob|gov|net)\.)?([a-z]{2})(?![\w.-])/giu;
/** An email address or a run of seven digits or more: a contact line. */
const CONTACT = /@|\d(?:[\s().-]*\d){6}/u;

/**
 * The region a resume's header names: its email's or site's country domain (".com.ar", ".cl"),
 * else a part of a header line that is the country's name or one of its cities ("Buenos Aires,
 * Argentina", "Lisboa"). The header runs to the line after the last contact line of the first
 * six, so a role's city further down never names it.
 */
function headerRegion(resumeText: string, regions: readonly AtsRegionPack[]) {
  const top = resumeText
    .slice(0, DETECTION_SAMPLE)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
  let contact = -1;
  for (const [at, line] of top.entries()) if (CONTACT.test(line)) contact = at;
  const header = top.slice(0, contact + 2);
  for (const [, domain] of header.join("\n").matchAll(COUNTRY_DOMAIN)) {
    const found = regions.find((region) => region.id === domain!.toUpperCase());
    if (found && !(domain === "co" && !/\.com\.co(?![\w.-])/iu.test(header.join("\n"))))
      return found;
  }
  // Split, then trim: a separator pattern with spaces on both sides rescans a run of spaces.
  const parts = header.flatMap((line) =>
    line
      .split(/[|,·•\t]|\s[–—-]\s/u)
      .map((part) => plain(part.trim()))
      .filter(Boolean),
  );
  // The country named beats a city: "Córdoba, España" is Spain, though Argentina has a Córdoba.
  return (
    regions.find((region) => parts.some((part) => countryOf(region).test(part))) ??
    parts.map((part) => regions.find((region) => placesOfRegion(region).test(part))).find(Boolean)
  );
}

/** A region's own name, whole, ignoring case and accents: "España", "Mexico". */
const countryOf = memo((region: AtsRegionPack) => new RegExp(`^${plain(region.name)}$`, "iu"));

/**
 * The policy a given resume (and posting) is scored with: the base, plus the attached language
 * packs it is written in, plus one region, plus the date order the resume's own dates show.
 *
 * The region is the one asked for, else the country of the first phone number with a country
 * code, else, for a resume a language pack reads, the region its header names (`headerRegion`),
 * else the default region of a language the resume is written in (or asked for). An English
 * resume is left to its phone number. Memoised per combination.
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
   * The language packs the resume itself is read in — those asked for, else those its bullets are
   * written in — leaving out a language only the posting is written in. Empty for the base;
   * `["und"]` when the resume is written neither in the base's language nor in a pack's. A pack
   * whose words its bullets hold fewer of than the base's adds its vocabulary but is not one.
   */
  resumeLanguages: string[];
} {
  const { languages: packs, regions } = policy.locales;
  // A region or language asked for is applied or refused, never silently dropped.
  const asked = options.region
    ? regions.find((pack) => pack.id === options.region!.toUpperCase())
    : undefined;
  if (options.region && !asked) throw notAttached("region", options.region, regions);
  // The policy's own language names no pack and is accepted. So is a language it recognises and no
  // pack reads (`text.otherLanguages`, by id or script: "it", "Cyrillic"): the resume is read as
  // detection would read it, with no pack and without the English writing rules.
  const askedLanguages = options.languages?.map((id) => id.toLowerCase());
  const recognised = (id: string) =>
    policy.text.otherLanguages.find(
      (other) => other.id === id || other.script?.toLowerCase() === id,
    );
  const unknown = askedLanguages?.find(
    (id) => id !== policy.text.language && !packs.some((pack) => pack.id === id) && !recognised(id),
  );
  if (unknown !== undefined) throw notAttached("language", unknown, packs);
  const askedOther = askedLanguages
    ?.filter((id) => !packs.some((pack) => pack.id === id))
    .map(recognised)
    .find(Boolean);
  const dateOrder = dateOrderIn(resumeText.slice(0, DETECTION_SAMPLE));
  const resumeSample = sampleOf(resumeText);
  // No pack's language: the base's, or "und" when the resume is not the base's either.
  const unsupportedIn = (ids: string[]) =>
    ids.length
      ? null
      : options.languages
        ? askedOther
          ? (askedOther.id ?? askedOther.script ?? UNDETERMINED)
          : null
        : (otherLanguageOf(policy, resumeSample) ?? null);
  if (packs.length === 0 && regions.length === 0 && dateOrder === undefined) {
    const unsupported = unsupportedIn([]);
    return {
      policy,
      locale: { languages: [], region: null, unsupported },
      resumeLanguages: unsupported ? [UNDETERMINED] : [],
    };
  }

  // Detected apart: a long English posting would dilute a German resume below the detection share.
  const posting =
    text === resumeText ? "" : text.startsWith(resumeText) ? text.slice(resumeText.length) : text;
  const postingSample = posting ? sampleOf(posting) : undefined;
  const inResume = packs.filter((pack) => isWrittenIn(resumeSample, pack));
  const languages = askedLanguages
    ? packs.filter((pack) => askedLanguages.includes(pack.id))
    : packs.filter(
        (pack) =>
          inResume.includes(pack) ||
          (postingSample !== undefined && isWrittenIn(postingSample, pack)),
      );
  // Every pack the resume has words of adds its vocabulary; the language of its bullets decides
  // rules and region (English bullets under a French summary stay English).
  const bullets = sampleOf(
    resumeText
      .slice(0, DETECTION_SAMPLE)
      .split("\n")
      .filter((line) => BULLET.test(line))
      .join("\n"),
  );
  const leading = options.languages
    ? languages
    : inResume.filter((pack) => outweighs(bullets, pack, policy.text));

  // A posting-only language says where the job is, not how the resume writes its dates.
  const country = asked ? undefined : phoneCountry(resumeText.slice(0, DETECTION_SAMPLE));
  const region =
    asked ??
    regions.find((pack) => pack.phoneCountry === country) ??
    (leading.length ? headerRegion(resumeText, regions) : undefined) ??
    leading
      .map((pack) => regions.find((candidate) => candidate.id === pack.defaultRegion))
      .find(Boolean);

  const locale = {
    languages: languages.map((pack) => pack.id),
    region: region?.id ?? null,
  };
  const key = `${locale.languages.join("+")}|${locale.region ?? ""}|${dateOrder ?? ""}`;

  const cached = localizedOf(policy);
  let localized = cached.get(key);
  if (!localized) {
    localized = languages.reduce(applyVocabulary, policy);
    if (region) localized = applyRegion(localized, region);
    // No region known: any attached region may still read a national number, but validity cannot
    // name a country (the "min" metadata accepts nearly any 10-digit run).
    else if (regions.length)
      localized = {
        ...localized,
        resumeParse: {
          ...localized.resumeParse,
          phoneRegions: union(
            localized.resumeParse.phoneRegions,
            regions.map((pack) => pack.phoneCountry),
          ),
          // And any attached region's cities: "Acme Ltd, Manchester" with no +44 number.
          cityNames: union(
            localized.resumeParse.cityNames,
            regions.flatMap((pack) => pack.cityNames ?? []),
          ),
        },
      };
    if (dateOrder)
      localized = { ...localized, resumeParse: { ...localized.resumeParse, dateOrder } };
    // Shared across resumes, so frozen.
    cached.set(key, deepFreeze(localized));
  }
  const read = leading.map((pack) => pack.id);
  const other = unsupportedIn(read);
  return {
    policy: localized,
    // A language a pack reads here (its words, not its bullets) is not one the engine cannot read.
    locale: { ...locale, unsupported: other && !locale.languages.includes(other) ? other : null },
    resumeLanguages: other ? [UNDETERMINED] : read,
  };
}
