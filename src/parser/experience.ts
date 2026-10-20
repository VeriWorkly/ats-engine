import type { AtsEnginePolicy } from "../policy/schema.js";
import type { AtsParsedRole } from "../types.js";
import { BULLET, BULLET_PREFIX, wordListPattern, wordListRegex } from "../text/text.js";
import { findDateRange } from "./dates.js";
import { headingConnector, isHeadingLine } from "./sections.js";
import { memo } from "../util/memo.js";

type HeaderMatchers = {
  titleWords: RegExp;
  /** What parts a header: separators, a column gap, or a joining word. Global, to walk them. */
  separators: RegExp;
  /** The separators stronger than a comma. Global. */
  strong: RegExp;
  /** A separator that is one of the words joining a title to its employer ("at", "bei"). */
  employerWord: RegExp;
  /** The same word, or "@", anywhere between words: "Analyst at Deloitte". */
  joined: RegExp;
  /** A school's word: "University", "College", "Institute". */
  school: RegExp;
  /** A word naming an organisation: a school's, a legal form ("Inc"), a kind ("Hospital"). */
  organisation: RegExp;
  /** The same, global, to take them out. */
  organisations: RegExp;
  verbOpener: RegExp;
  duration: RegExp;
  /** One word of a department's name: "Product", "Management". */
  department: RegExp;
};

const matchersOf = memo(({ resumeParse: rp, text }: AtsEnginePolicy): HeaderMatchers => {
  // Split before collapsing whitespace: a tab or run of spaces is the column gap between title and
  // employer. A lone "@" joins them too, spaced so an email address is never cut.
  const strong = String.raw`\s*[|·•]\s*|\s+[-–—@]\s+|\t+|\s{2,}|\s+${wordListPattern(rp.employerWords)}\s+`;
  const organisations = [...rp.organisationWords, ...rp.schoolWords];
  return {
    titleWords: wordListRegex(rp.titleWords),
    // "4 yrs 9 mos": how long, as LinkedIn prints beside the dates.
    duration: new RegExp(
      String.raw`(?<![\p{L}\p{N}])\d{1,2}\+?\s*${wordListPattern(rp.durationUnits)}\.?`,
      "giu",
    ),
    separators: new RegExp(String.raw`${strong}|,\s+`, "giu"),
    strong: new RegExp(strong, "giu"),
    employerWord: new RegExp(String.raw`^\s+${wordListPattern(rp.employerWords)}\s+$`, "iu"),
    joined: new RegExp(String.raw`\s(?:${wordListPattern(rp.employerWords)}|@)\s`, "iu"),
    school: wordListRegex(rp.schoolWords),
    organisation: wordListRegex(organisations),
    organisations: wordListRegex(organisations, "gi"),
    verbOpener: new RegExp(`^${wordListPattern(text.contentLineVerbs)}`, "iu"),
    department: new RegExp(`^(?:${rp.departmentWords.join("|")})$`, "iu"),
  };
});

const placesOf = memo((rp: AtsEnginePolicy["resumeParse"]) => ({
  code: new RegExp(`^(?:${rp.regionCodes.join("|")})$`, "u"),
  postNominal: new RegExp(`^(?:${rp.postNominals.join("|")})$`, "iu"),
  workplace: new RegExp(`^(?:${rp.workplaceWords.join("|")})$`, "iu"),
  name: new RegExp(`^(?:${rp.placeNames.join("|")})$`, "iu"),
  /** A country or a state named anywhere: "not in the US". */
  named: wordListRegex(rp.placeNames),
  /** A name ending in a legal form or an institution's kind: "Acme Corp", not "Bank Street". */
  company: new RegExp(`${wordListPattern(rp.organisationWords)}$`, "iu"),
}));

/** Whether the text names a country or a state (`placeNames`) anywhere. */
export const namesPlace = (text: string, policy: AtsEnginePolicy) =>
  placesOf(policy.resumeParse).named.test(text);

/** The policy's state and province codes, credentials after a name, and workplace words. */
export const placeWords = (policy: AtsEnginePolicy) => placesOf(policy.resumeParse);

/**
 * A line that says where a role is worked, not for whom ("San Francisco, CA", "Remote", "Berlin,
 * Germany", "Toronto, ON, Canada"). The policy names countries, states and provinces
 * (`placeNames`) but no cities, so "Acme, Berlin" is not one, and "Acme, Germany" is told from
 * "Berlin, Germany" only by a legal form, an institution's kind or a job title in its first part.
 *
 * `named: false` reads only codes and workplace words: a line of its own may as well be an
 * employer with its country ("Infosys, India") as a place.
 */
export function isPlace(line: string, policy: AtsEnginePolicy, named = true) {
  const { code, workplace, name, company } = placesOf(policy.resumeParse);
  const parts = line
    .replace(BULLET_PREFIX, "")
    .split(/[,|·•()\t]|\s{2,}/u)
    .map((part) => part.trim().replace(/\s\d{5}(?:-\d{4})?$/u, ""))
    .filter(Boolean);
  const isName = (part: string) => named && name.test(part);
  const where = (part: string) => code.test(part) || isName(part) || workplace.test(part);
  if (parts.length === 0) return false;
  if (parts.every(where)) return true;
  // "City, ST", "City, State" or "City, Country", then perhaps more of where. A first part ending
  // in a legal form is an employer, and one holding a job title, a joining word or an
  // organisation is not a city.
  const { titleWords, organisation, joined } = matchersOf(policy);
  return (
    parts.length >= 2 &&
    !joined.test(parts[0]) &&
    // A one-word city may be named like a title ("Engineer, TX"); a two-word title is not one.
    ((code.test(parts[1]) && !(titleWords.test(parts[0]) && /\s/u.test(parts[0]))) ||
      (isName(parts[1]) && !titleWords.test(parts[0]) && !organisation.test(parts[0]))) &&
    parts.slice(2).every(where) &&
    parts[0].split(/\s+/).length <= 3 &&
    !company.test(parts[0])
  );
}

/** A line opening with one of the policy's action verbs: a description, not a header. */
export const opensWithVerb = (line: string, policy: AtsEnginePolicy) =>
  matchersOf(policy).verbOpener.test(line);

/** A header longer than this ran to the page's width, so a short line under it continues it ("…Public" / "Health"). */
const WRAP_WIDTH = 48;

/** A header cut at its separators; a joining word inside a school's name is not one ("University of Texas at Austin"). */
function splitHeader(
  header: string,
  policy: AtsEnginePolicy,
  separators = matchersOf(policy).separators,
): string[] {
  const { employerWord, school } = matchersOf(policy);
  const parts: string[] = [];
  let part = "";
  let from = 0;
  for (const match of header.matchAll(separators)) {
    part += header.slice(from, match.index);
    from = match.index + match[0].length;
    if (employerWord.test(match[0]) && school.test(part)) part += match[0];
    else {
      parts.push(part);
      part = "";
    }
  }
  parts.push(part + header.slice(from));
  return parts;
}

function headerParts(header: string, policy: AtsEnginePolicy) {
  // Empty brackets are what is left of a bracketed date range. A leading "." stays before a word (".NET").
  return splitHeader(header.replace(BULLET_PREFIX, "").replace(/\(\s*\)|\[\s*\]/g, " "), policy)
    .map((part) =>
      // The trailing run is matched from its first character to avoid retrying from every position.
      part
        .replace(/\s+/g, " ")
        .replace(/^(?:[\s|,\-–—]|\.(?![\p{L}\p{N}]))+|(?<![\s|,.\-–—])[\s|,.\-–—]+$/gu, ""),
    )
    .filter(Boolean);
}

/**
 * Splits a role header into a job title and an employer. Resumes write both orders ("Staff
 * Engineer, Acme", "Acme — Staff Engineer"), so the side with a job-title word decides; with
 * neither, the first is the title.
 *
 * A comma also parts a title from its qualifier ("Director, Product Management"). The title keeps
 * its comma when a stronger separator (bar, dash, tab, "at") parts it from a part naming an
 * organisation, or from any employer when what follows the comma is a department
 * (`departmentWords`), or, with commas only, when a later part names an organisation. An
 * organisation is named by its legal form ("Inc", "GmbH") or kind ("Hospital"); without one,
 * "Software Engineer, Acme | Berlin" is a title, an employer and where.
 *
 * A city of one or two words and its state's code ("Austin, TX") is where, unless "at" or "@"
 * parts it from the title ("Analyst at Deloitte, NY"). Otherwise "Software Engineer, Google, CA"
 * cannot be told from "Senior Engineer, Austin, TX" without a city list, so none has an employer.
 */
export function splitTitleAndEmployer(header: string, policy: AtsEnginePolicy) {
  const { titleWords, organisation, organisations, strong, department, joined } =
    matchersOf(policy);
  const connector = headingConnector(policy.resumeParse);
  const isDepartment = (part: string) =>
    part.split(" ").every((word) => department.test(word) || connector.test(word));
  // The parts between strong separators, each cut at its commas.
  const segments = splitHeader(header.replace(BULLET_PREFIX, ""), policy, strong)
    .map((segment) => headerParts(segment, policy))
    .filter((segment) => segment.length);
  const parts = segments.flat();
  const sure = joined.test(header);

  if (parts.length === 0) return { title: "", employer: "" };
  if (parts.length === 1) return { title: parts[0], employer: "" };

  const named = (text: string) => organisation.test(text);
  // With no title word, an organisation's name first ("Globex Corporation, Croupier") is the
  // employer, unless what follows is only where.
  let titleIndex = parts.findIndex((part) => titleWords.test(part));
  if (titleIndex === -1)
    titleIndex = +(
      named(parts[0]!) &&
      !named(parts[1]!) &&
      !isPlace(parts.slice(1).join(", "), policy)
    );
  // Where the employer starts after a title of several parts, or -1.
  let end = -1;
  if (segments.length > 1) {
    let at = 0;
    const own = segments.find((segment) => (at += segment.length) > titleIndex)!;
    const other = segments.find(
      (segment) => segment !== own && !isPlace(segment.join(", "), policy),
    );
    if (
      own.length > 1 &&
      own[0] === parts[titleIndex] &&
      other &&
      (named(other.join(" ")) || own.slice(1).every(isDepartment))
    )
      end = at;
  } else {
    // A capitalised organisation name that does not start a place ("Bank Street, NY" is where).
    const found = parts.findIndex(
      (part, at) =>
        at > titleIndex &&
        named(part) &&
        /^\p{Lu}/u.test(part) &&
        !isPlace(parts.slice(at).join(", "), policy),
    );
    // A legal form on its own ("Acme, Inc.") is the end of the part before it.
    end = found - +!/[\p{L}\p{N}]/u.test(parts[found]?.replace(organisations, "") ?? "x");
    if (end < titleIndex + 2) end = -1;
  }
  if (end !== -1)
    return {
      title: parts.slice(titleIndex, end).join(", "),
      employer: withoutPlace([...parts.slice(0, titleIndex), ...parts.slice(end)], policy, sure),
    };

  const employer = withoutPlace(
    parts.filter((_, index) => index !== titleIndex),
    policy,
    sure,
  );
  return { title: parts[titleIndex], employer };
}

/**
 * The employer's parts, joined, without where the role is worked after them ("Acme, San
 * Francisco, CA" and "Acme, Remote" are Acme). Only "City, ST", the policy's countries and states,
 * and workplace words are places (`isPlace`); "Acme, Berlin" keeps its city. A workplace word or
 * state code alone names no employer. Nor, unless `sure`, does a city of one or two words with a
 * state code ("Austin, TX"); when sure ("Analyst at" before it) the employer is kept, as is a
 * longer one (an employer run into its city) or one ending in a legal form ("Acme Corp, TX").
 * A country or state named in full goes, with the city before it when a part is left ("Infosys,
 * India" is Infosys), and so does a place in brackets ("Netflix (Remote)").
 */
function withoutPlace(parts: string[], policy: AtsEnginePolicy, sure: boolean): string {
  const { code, workplace, name, company } = placesOf(policy.resumeParse);
  const coded = (part: string) => code.test(part.replace(/\s\d{5}(?:-\d{4})?$/u, ""));
  const short = (part: string) => part.split(/\s+/).length <= 3 && !company.test(part);
  if (parts.length === 1 && (workplace.test(parts[0]!) || coded(parts[0]!))) return "";
  if (
    parts.length === 2 &&
    coded(parts[1]!) &&
    parts[0]!.split(/\s+/).length <= 2 &&
    !company.test(parts[0]!)
  )
    return sure && !workplace.test(parts[0]!) && !matchersOf(policy).titleWords.test(parts[0]!)
      ? parts[0]!
      : "";
  let end = parts.length;
  while (end > 1 && workplace.test(parts[end - 1]!)) end -= 1;
  const named = end;
  while (end > 1 && name.test(parts[end - 1]!)) end -= 1;
  if (end > 2 && coded(parts[end - 1]!) && parts[end - 2]!.split(/\s+/).length <= 3) end -= 2;
  else if (end > 1 && coded(parts[end - 1]!) && company.test(parts[end - 2]!)) end -= 1;
  else if (end < named && end > 1 && short(parts[end - 1]!)) end -= 1;
  const employer = parts.slice(0, end).join(", ");
  const where = / ?\(([^()]{1,60})\)$/u.exec(employer);
  return where?.index && isPlace(where[1]!, policy) ? employer.slice(0, where.index) : employer;
}

/**
 * Recovers one row per job. A date range anchors each entry (the one element every work-history
 * block has, and what tenure needs). Title and employer are read from the same line, else the
 * line above (or two above, when stacked), else the line below for resumes that print dates first.
 *
 * When the dated line holds only one half ("Founder & Developer 2025-01 - Present" over
 * "VeriWorkly | Remote"), the other is read from the neighbouring line, first part only.
 *
 * Bullet lines are never anchors: their numbers ("grew revenue 2019 - 2021") are not tenure.
 */
export function parseRoles(
  given: string[],
  policy: AtsEnginePolicy,
  now: Date = new Date(),
): AtsParsedRole[] {
  const roles: AtsParsedRole[] = [];

  const rp = policy.resumeParse;
  const lines = joinWrappedDates(given, rp, now);
  const { verbOpener: opensWithVerb, titleWords, duration } = matchersOf(policy);
  // The employer the last employer line named, for the roles under it that name none.
  let group = "";
  // A header is a short, unbulleted line with no dates; a trailing full stop is allowed. A header in
  // parts ("Engineer | Acme | Remote") runs longer than a heading: up to 12 words, no action verb.
  const isPartedHeader = (line: string) => {
    const words = line.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
    return (
      line.length <= 100 &&
      words <= 12 &&
      !/[.,;।]$/u.test(line) &&
      headerParts(line, policy).length >= 2 &&
      !opensWithVerb.test(line)
    );
  };
  // How long a role ran, on a line of its own ("4 years 9 months"): neither title nor employer.
  const durationOnly = (line: string | undefined) =>
    line !== undefined && !/[\p{L}\p{N}]/u.test(line.replace(duration, ""));
  const isHeader = (line: string | undefined): line is string =>
    line !== undefined &&
    !BULLET.test(line) &&
    (isHeadingLine(line.replace(/\.$/, "")) || isPartedHeader(line.replace(/\.$/, ""))) &&
    !durationOnly(line) &&
    !findDateRange(line, rp, now);
  const isLongHeader = (line: string | undefined): line is string =>
    line !== undefined &&
    !BULLET.test(line) &&
    line.length <= 120 &&
    line.trim().split(/\s+/).length <= 14 &&
    !/[.,;।]$/u.test(line.replace(/\.$/, "")) &&
    !findDateRange(line, rp, now);
  const isSingle = (line: string) => splitTitleAndEmployer(line, policy).employer === "";
  const lettersIn = (text: string) => text.match(/\p{L}/gu)?.length ?? 0;

  // Every dated line, with the header text it carries itself (a place beside the dates is none).
  const anchors = lines.flatMap((line, index) => {
    const found = BULLET.test(line) ? null : findDateRange(line, rp, now);
    if (!found) return [];
    const remainder = line.replace(found.matched, " ").replace(duration, " ").trim();
    // A country or state names where only after the dates; before them "Infosys, India" is the employer.
    const after = lettersIn(line.slice(0, line.indexOf(found.matched))) === 0;
    const own = lettersIn(remainder) >= 3 && !isPlace(remainder, policy, after) ? remainder : "";
    return [{ index, found, own }];
  });
  const ownAt = new Map(anchors.map((anchor) => [anchor.index, anchor.own]));

  // Lines already read into a header, so one employer line never serves two roles.
  const used = new Set<number>();
  const take = (at: number) => {
    used.add(at);
    return lines[at];
  };
  const free = (at: number) => !used.has(at) && isHeader(lines[at]);

  // The half of a header a dated line lacks, read from the line at `at`. An unbulleted description
  // is header-shaped too; an action verb gives it away. The line below is not free when it is the
  // next role's header, and a place is where, not who.
  const halfAt = (at: number, from: number) => {
    if (!free(at) || opensWithVerb.test(lines[at]) || isPlace(lines[at], policy, false))
      return null;
    if (at > from && ownAt.get(at + 1) === "") return null;
    return headerParts(lines[at], policy)[0] ?? null;
  };

  // A resume repeats one layout, so which side holds the missing half is decided once, by the roles
  // where only one side could (per role, "above" would take a closing line as the next employer).
  const halves = anchors.filter((anchor) => anchor.own && isSingle(anchor.own));
  const aboveVotes = halves.filter((a) => halfAt(a.index - 1, a.index)).length;
  const belowVotes = halves.filter((a) => halfAt(a.index + 1, a.index)).length;
  const sides = belowVotes > aboveVotes ? [1, -1] : [-1, 1];

  const titled = (at: number) => titleWords.test(lines[at] ?? "");
  // Dates first ("2020 - Present" over "Senior Engineer, Acme"): every bare date line then reads
  // the line below before the one above, which ends the previous role.
  const [first] = anchors;
  const datesFirst =
    first !== undefined &&
    !first.own &&
    !isHeader(lines[first.index - 1]) &&
    isHeader(lines[first.index + 1]);
  // A neighbour that is a whole header: a title and an employer ("Founder - Acme").
  const whole = (at: number, from: number) =>
    halfAt(at, from) !== null && !isSingle(lines[at]) && titled(at);

  for (const { index, found, own } of anchors) {
    let header = own;
    if (own && isSingle(own)) {
      // The neighbour is the header; what the dated line carries besides dates is where, not who.
      const full = titled(index) ? undefined : sides.find((offset) => whole(index + offset, index));
      const side = full ?? sides.find((offset) => halfAt(index + offset, index));
      // Only its title is not where.
      if (full !== undefined) header = take(index + full);
      else if (side !== undefined)
        header = `${splitTitleAndEmployer(own, policy).title} | ${headerParts(take(index + side), policy)[0]}`;
    } else if (own && !titled(index)) {
      // No title word beside the dates ("Acme Corp, Berlin") and a title alone next to them: the
      // dated line is the employer and where.
      const side = sides.find(
        (offset) =>
          titled(index + offset) &&
          halfAt(index + offset, index) !== null &&
          isSingle(lines[index + offset]!),
      );
      if (side !== undefined) header = `${take(index + side)} | ${own}`;
    }
    // Stacked above a bare date line ("Engineer" over "Acme"): the line two up is the title when it
    // holds one and the line above does not. Only the employer line's first part is the employer.
    const stacked = (above: number) =>
      free(above - 1) &&
      isSingle(lines[above - 1]) &&
      (isSingle(lines[above]) || (titled(above - 1) && !titled(above)));
    // A whole header over a short, title-less line over the dates: the short line is where (dropped),
    // the end of a wrapped header (put back), or the employer under a title and team (kept).
    // Such a header ran to the page's width, so it may be longer than a heading-shaped line.
    const wrapped = (above: number) =>
      free(above) &&
      !used.has(above - 1) &&
      isLongHeader(lines[above - 1]) &&
      titled(above - 1) &&
      !isSingle(lines[above - 1]) &&
      !titled(above) &&
      (isSingle(lines[above]) || isPlace(lines[above], policy)) &&
      !opensWithVerb.test(lines[above]);
    let top = index;
    if (!header && datesFirst && free(index + 1)) header = take(index + 1);
    // Where the role is worked, on a line between its header and the dates, is dropped. A country
    // or state names where only when the lines above name the employer.
    const where = (at: number) =>
      isPlace(lines[at]!, policy, false) ||
      (isPlace(lines[at]!, policy) && (!isSingle(lines[at - 1]!) || stacked(at - 1)));
    let dates = index;
    // How long the role ran, between its header and dates, is neither: the header is above.
    if (!header && durationOnly(lines[dates - 1]) && !used.has(dates - 1)) {
      dates -= 1;
      take(dates);
    }
    if (!header && free(dates - 1) && free(dates - 2) && where(dates - 1)) {
      take(dates - 1);
      dates -= 1;
    }
    if (!header && free(dates - 1)) {
      if (wrapped(dates - 1)) {
        const short = take(dates - 1).trim();
        const long = take(dates - 2).trim();
        header = isPlace(short, policy)
          ? long
          : `${long}${long.length >= WRAP_WIDTH ? " " : ", "}${short}`;
        top = dates - 2;
      } else if (stacked(dates - 1)) {
        header = `${take(dates - 2)} | ${headerParts(take(dates - 1), policy)[0]}`;
        top = dates - 2;
      } else {
        header = take(dates - 1);
        top = dates - 1;
      }
    }
    if (!header && free(index + 1)) header = take(index + 1);

    const split = splitTitleAndEmployer(header, policy);
    let { employer } = split;
    // Several roles under one employer: its line names every role under it until a role names its
    // own. It opens a group only at the section start or after the previous role's bullets; else,
    // and as a place, it ends the previous role. A duration line may sit between it and the title.
    if (split.title && !employer) {
      const above = durationOnly(lines[top - 1]) && !used.has(top - 1) ? top - 2 : top - 1;
      if (
        titled(top) &&
        free(above) &&
        !titled(above) &&
        employerLine(lines[above]) &&
        (above === 0 || BULLET.test(lines[above - 1])) &&
        !isPlace(lines[above], policy, false)
      ) {
        employer = headerParts(take(above), policy)[0] ?? "";
        group = employer;
      } else employer = group;
    } else if (employer) {
      // Stacked, the employer over the title heads a group too.
      group = top === dates - 2 && employer === headerParts(lines[top], policy)[0] ? employer : "";
    }
    roles.push({ ...found.range, title: split.title, employer });
  }

  return roles;
}

/** A line that can name an employer above a role: no label (":"), not a lowercase sentence opening. */
const employerLine = (line: string) => !line.includes(":") && /^[\p{Lu}\p{N}]/u.test(line);

/**
 * A date range the page wrapped onto two lines ("Aug 2018 – Aug" over "2021"), rejoined. Only a
 * short date-shaped line joins, and only when neither line holds a range alone and together they
 * do ("Senior Engineer, 23andMe" over "2018 - 2019" is a header over its dates).
 */
function joinWrappedDates(lines: readonly string[], rp: AtsEnginePolicy["resumeParse"], now: Date) {
  const joined: string[] = [];
  for (let at = 0; at < lines.length; at += 1) {
    const line = lines[at];
    const next = lines[at + 1];
    if (
      next !== undefined &&
      next.length <= 12 &&
      /^['’‘]?\d/u.test(next) &&
      !BULLET.test(line) &&
      /\d/.test(line) &&
      !findDateRange(line, rp, now) &&
      !findDateRange(next, rp, now) &&
      findDateRange(`${line} ${next}`, rp, now)
    ) {
      joined.push(`${line} ${next}`);
      at += 1;
      continue;
    }
    // A row whose two sides both wrap: each side is rejoined with its own continuation.
    const [left, right, ...restLine] = line.split("\t");
    const [nextLeft, nextRight, ...restNext] = next?.split("\t") ?? [];
    if (
      right !== undefined &&
      nextRight !== undefined &&
      !restLine.length &&
      !restNext.length &&
      nextRight.trim().length <= 12 &&
      /^['’‘]?\d/u.test(nextRight.trim()) &&
      !BULLET.test(line) &&
      !findDateRange(right, rp, now) &&
      !findDateRange(nextRight, rp, now) &&
      findDateRange(`${right} ${nextRight.trim()}`, rp, now)
    ) {
      joined.push(`${left} ${nextLeft!.trim()}\t${right} ${nextRight.trim()}`);
      at += 1;
    } else joined.push(line);
  }
  return joined;
}

/** The policy's job-title words, compiled once. */
export function titleWordsOf(policy: AtsEnginePolicy) {
  return matchersOf(policy).titleWords;
}

/** The policy's organisation and school words, compiled once. */
export function organisationWordsOf(policy: AtsEnginePolicy) {
  return matchersOf(policy).organisation;
}
