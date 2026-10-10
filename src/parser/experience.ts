import type { AtsEnginePolicy } from "../policy/schema.js";
import type { AtsParsedRole } from "../types.js";
import { BULLET, BULLET_PREFIX, wordListPattern, wordListRegex } from "../text/text.js";
import { findDateRange } from "./dates.js";
import { isHeadingLine } from "./sections.js";
import { memo } from "../util/memo.js";

type HeaderMatchers = {
  titleWords: RegExp;
  /** What parts a header: separators, a column gap, or a joining word. Global, to walk them. */
  separators: RegExp;
  /** The separators stronger than a comma. Global. */
  strong: RegExp;
  /** A separator that is one of the words joining a title to its employer ("at", "bei"). */
  employerWord: RegExp;
  /** A school's word: "University", "College", "Institute". */
  school: RegExp;
  /** A word naming an organisation: a school's, a legal form ("Inc"), a kind ("Hospital"). */
  organisation: RegExp;
  /** The same, global, to take them out. */
  organisations: RegExp;
  verbOpener: RegExp;
  duration: RegExp;
};

const matchersOf = memo(({ resumeParse: rp, text }: AtsEnginePolicy): HeaderMatchers => {
  // Split before collapsing whitespace: a tab or a run of spaces is a column gap between
  // title and employer, and collapsing it first merged the two into one field. The words
  // that join a title to its employer ("Engineer at Acme", "Entwickler bei Acme") are data; an
  // "@" standing alone ("Data Scientist @ Netflix") is the symbol for them, and spaced so an
  // email address is never cut.
  const strong = String.raw`\s*[|·•]\s*|\s+[-–—@]\s+|\t+|\s{2,}|\s+${wordListPattern(rp.employerWords)}\s+`;
  const organisations = [...rp.organisationWords, ...rp.schoolWords];
  return {
    titleWords: wordListRegex(rp.titleWords),
    // "4 yrs 9 mos", "(4 years 9 months)": how long, which LinkedIn prints beside the dates.
    duration: new RegExp(
      String.raw`(?<![\p{L}\p{N}])\d{1,2}\+?\s*${wordListPattern(rp.durationUnits)}\.?`,
      "giu",
    ),
    separators: new RegExp(String.raw`${strong}|,\s+`, "giu"),
    strong: new RegExp(strong, "giu"),
    employerWord: new RegExp(String.raw`^\s+${wordListPattern(rp.employerWords)}\s+$`, "iu"),
    school: wordListRegex(rp.schoolWords),
    organisation: wordListRegex(organisations),
    organisations: wordListRegex(organisations, "gi"),
    verbOpener: new RegExp(`^${wordListPattern(text.contentLineVerbs)}`, "iu"),
  };
});

const placesOf = memo((rp: AtsEnginePolicy["resumeParse"]) => ({
  code: new RegExp(`^(?:${rp.regionCodes.join("|")})$`, "u"),
  postNominal: new RegExp(`^(?:${rp.postNominals.join("|")})$`, "iu"),
  workplace: new RegExp(`^(?:${rp.workplaceWords.join("|")})$`, "iu"),
}));

/** The policy's state and province codes, credentials after a name, and workplace words. */
export const placeWords = (policy: AtsEnginePolicy) => placesOf(policy.resumeParse);

/**
 * A line that says where a role is worked, not for whom: "San Francisco, CA", "Austin, TX
 * 78701", "Remote", "Boston, MA (Hybrid)". A city with a country ("Berlin, Germany") is not told
 * from an employer with its city ("Acme, Berlin") without a gazetteer, so it is not one.
 */
export function isPlace(line: string, policy: AtsEnginePolicy) {
  const { code, workplace } = placesOf(policy.resumeParse);
  const parts = line
    .replace(BULLET_PREFIX, "")
    .split(/[,|·•()\t]|\s{2,}/u)
    .map((part) => part.trim().replace(/\s\d{5}(?:-\d{4})?$/u, ""))
    .filter(Boolean);
  const where = (part: string) => code.test(part) || workplace.test(part);
  if (parts.length === 0) return false;
  if (parts.every(where)) return true;
  // "City, ST", then perhaps how it is worked.
  return (
    parts.length >= 2 &&
    code.test(parts[1]) &&
    parts.slice(2).every(where) &&
    parts[0].split(/\s+/).length <= 3
  );
}

/** A line opening with one of the policy's action verbs: a description, not a header. */
export const opensWithVerb = (line: string, policy: AtsEnginePolicy) =>
  matchersOf(policy).verbOpener.test(line);

/**
 * A header longer than this ran to the page's width, so a short line under it is the rest of it
 * ("…School of Public" / "Health"); a shorter one ended where it meant to, and the short line
 * under it is a field of its own ("Software Engineer - Backend" / "Stripe").
 */
const WRAP_WIDTH = 48;

/**
 * A header cut at its separators. A joining word inside a school's name is not one: "The
 * University of Texas at Austin" is one employer, where "Research Assistant at University of
 * Michigan" is a title and an employer.
 */
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
  // Empty brackets are what is left of "(Jan 2020 - Present)" once the dates are taken out. A
  // leading "." is kept when a word follows it: ".NET Developer".
  return splitHeader(header.replace(BULLET_PREFIX, "").replace(/\(\s*\)|\[\s*\]/g, " "), policy)
    .map((part) =>
      // The trailing run is matched from its first character only: unanchored, a long run of
      // separators would be retried from every position in it.
      part
        .replace(/\s+/g, " ")
        .replace(/^(?:[\s|,\-–—]|\.(?![\p{L}\p{N}]))+|(?<![\s|,.\-–—])[\s|,.\-–—]+$/gu, ""),
    )
    .filter(Boolean);
}

/**
 * Splits a role header into a job title and an employer.
 *
 * Resumes write this both ways round — "Staff Engineer, Acme" and "Acme — Staff Engineer" — so
 * the side carrying a recognisable job-title word decides, rather than the position. When
 * neither side looks like a title the first is taken as the title, which is the more common
 * order; the field is still reported, and the completeness check below is what tells the
 * candidate the pair was ambiguous.
 *
 * A comma also parts a title from its qualifier ("Director, Product Management", "VP,
 * Engineering"). The title keeps its comma when what follows it up to the employer is not the
 * employer: when a separator stronger than a comma (a bar, a dash, a tab, "at") parts it from
 * a part naming an organisation ("Director, Product Management | Acme Corp"), or, with commas
 * only, when a later part names one ("VP, Engineering, Acme Corp"). An organisation is named by
 * its legal form ("Inc", "GmbH") or its kind ("Hospital", "University"): without one, "Software
 * Engineer, Acme | Berlin" is a title, an employer and where.
 */
export function splitTitleAndEmployer(header: string, policy: AtsEnginePolicy) {
  const { titleWords, organisation, organisations, strong } = matchersOf(policy);
  // The parts between strong separators, each cut at its commas.
  const segments = splitHeader(header.replace(BULLET_PREFIX, ""), policy, strong)
    .map((segment) => headerParts(segment, policy))
    .filter((segment) => segment.length);
  const parts = segments.flat();

  if (parts.length === 0) return { title: "", employer: "" };
  if (parts.length === 1) return { title: parts[0], employer: "" };

  const named = (text: string) => organisation.test(text);
  // With no title word on either side, an organisation's name first ("Globex Corporation,
  // Croupier") is the employer, unless what follows it is only where.
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
    if (own.length > 1 && own[0] === parts[titleIndex] && other && named(other.join(" "))) end = at;
  } else {
    const found = parts.findIndex((part, at) => at > titleIndex && named(part));
    // A legal form on its own ("Acme, Inc.") is the end of the part before it.
    end = found - +!/[\p{L}\p{N}]/u.test(parts[found]?.replace(organisations, "") ?? "x");
    if (end < titleIndex + 2) end = -1;
  }
  if (end !== -1)
    return {
      title: parts.slice(titleIndex, end).join(", "),
      employer: withoutPlace([...parts.slice(0, titleIndex), ...parts.slice(end)], policy),
    };

  const employer = withoutPlace(
    parts.filter((_, index) => index !== titleIndex),
    policy,
  );
  return { title: parts[titleIndex], employer };
}

/**
 * The employer's parts, joined, without where the role is worked after them: "Acme, San
 * Francisco, CA" is Acme, "Acme, Remote" is Acme. Only "City, ST" and workplace words are places
 * (see `isPlace`); "Acme, Berlin" keeps its city. A workplace word alone ("Remote") or a city
 * of one or two words and its state ("Austin, TX") names no employer, so there is none; a
 * longer one may be an employer run into its city ("Oakmont Foods Portland, OR"), and is kept. A
 * place in brackets after the name ("Netflix (Remote)") goes too.
 */
function withoutPlace(parts: string[], policy: AtsEnginePolicy): string {
  const { code, workplace } = placesOf(policy.resumeParse);
  if (
    (parts.length === 1 && workplace.test(parts[0]!)) ||
    (parts.length === 2 &&
      code.test(parts[1]!.replace(/\s\d{5}(?:-\d{4})?$/u, "")) &&
      parts[0]!.split(/\s+/).length <= 2)
  )
    return "";
  let end = parts.length;
  while (end > 1 && workplace.test(parts[end - 1]!)) end -= 1;
  if (
    end > 2 &&
    code.test(parts[end - 1]!.replace(/\s\d{5}(?:-\d{4})?$/u, "")) &&
    parts[end - 2]!.split(/\s+/).length <= 3
  )
    end -= 2;
  const employer = parts.slice(0, end).join(", ");
  // Where, in brackets after the name: "Netflix (Remote)", "Acme (Austin, TX)". The parts'
  // whitespace is collapsed, so one space at most comes before the bracket.
  const where = / ?\(([^()]{1,60})\)$/u.exec(employer);
  return where?.index && isPlace(where[1]!, policy) ? employer.slice(0, where.index) : employer;
}

/**
 * Recovers one row per job.
 *
 * A date range anchors each entry, because that is the one element every work-history block has
 * and the one an ATS needs in order to compute tenure at all. The title and employer are read
 * from the same line; failing that from the line above — or the two lines above, when title and
 * employer are stacked — and failing that from the line below, for resumes that print dates
 * first.
 *
 * When the dated line holds only one half — "Founder & Developer 2025-01 - Present" with
 * "VeriWorkly | Remote" under it, or "Acme Corporation" over it — the other half is read from
 * the neighbouring line. Only its first part is taken: the employer, not the "Remote" or city
 * after it.
 *
 * Bullet lines are never role anchors. A bullet describes work inside a role, and the numbers in
 * one ("grew revenue 2019 - 2021", "from 1000 to 5000 users") are achievements, not tenure.
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
  // A header is a short, unbulleted line with no dates of its own. A trailing full stop does not
  // make "Senior Engineer, Acme Corp." a sentence.
  // A header in parts — "Engineer, Acme — San Francisco, CA", "Engineer | Acme | Remote" — runs
  // longer than a heading, and its separators are not words: up to 12 words, and not opening
  // with an action verb, which a description line would.
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
  // How long a role or a stay at an employer ran, on a line of its own ("4 years 9 months" under
  // LinkedIn's employer): neither a title nor an employer.
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

  // Every dated line, with the header text it carries itself. Where the role is worked, beside
  // its dates ("Jan 2020 - Present | Austin, TX"), is none: the header is elsewhere.
  const anchors = lines.flatMap((line, index) => {
    const found = BULLET.test(line) ? null : findDateRange(line, rp, now);
    if (!found) return [];
    const remainder = line.replace(found.matched, " ").replace(duration, " ").trim();
    const own = lettersIn(remainder) >= 3 && !isPlace(remainder, policy) ? remainder : "";
    return [{ index, found, own }];
  });
  const ownAt = new Map(anchors.map((anchor) => [anchor.index, anchor.own]));

  // Lines already read into a role's header, so one employer line never serves two roles.
  const used = new Set<number>();
  const take = (at: number) => {
    used.add(at);
    return lines[at];
  };
  const free = (at: number) => !used.has(at) && isHeader(lines[at]);

  // The half of a header a dated line lacks, read from the line at `at`. A short description
  // line without a bullet ("Led the platform team") is header-shaped too; opening with an
  // action verb is what gives it away. The line below a role is not free when it is the header
  // of the next role, whose dated line, two down, carries none of its own. A place ("Austin,
  // TX") is where the role is worked, not who it is for.
  const halfAt = (at: number, from: number) => {
    if (!free(at) || opensWithVerb.test(lines[at]) || isPlace(lines[at], policy)) return null;
    if (at > from && ownAt.get(at + 1) === "") return null;
    return headerParts(lines[at], policy)[0] ?? null;
  };

  // Resumes repeat one layout for every role, so which side holds the missing half is decided
  // once, by the roles where only one side could. Asked per role, "above" would take a short
  // unbulleted closing line of the previous role as the next role's employer.
  const halves = anchors.filter((anchor) => anchor.own && isSingle(anchor.own));
  const aboveVotes = halves.filter((a) => halfAt(a.index - 1, a.index)).length;
  const belowVotes = halves.filter((a) => halfAt(a.index + 1, a.index)).length;
  const sides = belowVotes > aboveVotes ? [1, -1] : [-1, 1];

  const titled = (at: number) => titleWords.test(lines[at] ?? "");
  // Dates first ("2020 - Present" over "Senior Engineer, Acme"): the first role's dates open the
  // block with its header below, so every bare date line reads the line below before the one
  // above, which is the last line of the role before ("Reduced costs by 30% across 4 teams").
  const [first] = anchors;
  const datesFirst =
    first !== undefined &&
    !first.own &&
    !isHeader(lines[first.index - 1]) &&
    isHeader(lines[first.index + 1]);
  // A neighbour that is a whole header on its own: a title and an employer, "Founder - Acme".
  const whole = (at: number, from: number) =>
    halfAt(at, from) !== null && !isSingle(lines[at]) && titled(at);

  for (const { index, found, own } of anchors) {
    let header = own;
    if (own && isSingle(own)) {
      // "Founder & Developer - VeriWorkly" over "2025-01 - Present | Remote": the neighbour is
      // the header, and what the dated line carries besides its dates is where, not who.
      const full = titled(index) ? undefined : sides.find((offset) => whole(index + offset, index));
      const side = full ?? sides.find((offset) => halfAt(index + offset, index));
      // Its title is all it carries that is not where: "Acme Corp | Austin, TX" is Acme Corp.
      if (full !== undefined) header = take(index + full);
      else if (side !== undefined)
        header = `${splitTitleAndEmployer(own, policy).title} | ${headerParts(take(index + side), policy)[0]}`;
    }
    // Stacked above a bare date line: "Engineer" over "Acme", or a title over "Acme, Munich" —
    // the line two up is the title when it holds one and the line above does not. Only the first
    // part of the employer line is the employer; the rest is where.
    const stacked = (above: number) =>
      free(above - 1) &&
      isSingle(lines[above - 1]) &&
      (isSingle(lines[above]) || (titled(above - 1) && !titled(above)));
    // A whole header over a short line with no title of its own, over the dates: the short line
    // is where ("Remote", "Austin, TX"), which is dropped; the end of a header the page wrapped
    // ("…School of Public" / "Health"), which is put back; or the employer under a title and
    // team ("Software Engineer - Backend" / "Stripe"), which is kept beside it.
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
    // Where the role is worked, on a line of its own between its header and the dates
    // ("Amazon" / "Seattle, WA" / "Jan 2020 - Present"), is dropped: the header is above it.
    let dates = index;
    if (!header && free(index - 1) && free(index - 2) && isPlace(lines[index - 1], policy)) {
      take(index - 1);
      dates = index - 1;
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
    // Several roles under one employer: "Acme Corporation, New York, NY" on a line of its own
    // over a title and its dates, then more titles and dates. The employer line names every role
    // under it, until a role names its own. It opens a group, so it starts the section or follows
    // the bullets of the role before; anywhere else, and as a place ("San Francisco, CA"), it is
    // the end of the role before. LinkedIn prints the time at the employer between it and the
    // first title ("Acme Corp" / "4 years 9 months" / "Senior Engineer").
    if (split.title && !employer) {
      const above = durationOnly(lines[top - 1]) && !used.has(top - 1) ? top - 2 : top - 1;
      if (
        titled(top) &&
        free(above) &&
        !titled(above) &&
        employerLine(lines[above]) &&
        (above === 0 || BULLET.test(lines[above - 1])) &&
        !isPlace(lines[above], policy)
      ) {
        employer = headerParts(take(above), policy)[0] ?? "";
        group = employer;
      } else employer = group;
    } else if (employer) {
      // Stacked with the employer over the title, it heads a group too.
      group = top === index - 2 && employer === headerParts(lines[top], policy)[0] ? employer : "";
    }
    roles.push({ ...found.range, title: split.title, employer });
  }

  return roles;
}

/**
 * A line that can name an employer above a role: no label (":"), not a sentence's lowercase
 * opening. Header-shaped and title-free are checked by the caller.
 */
const employerLine = (line: string) => !line.includes(":") && /^[\p{Lu}\p{N}]/u.test(line);

/**
 * A date range the page wrapped onto two lines — "Aug 2018 – Aug" over "2021", "2003 –" over
 * "2008" — rejoined, so the role it dates is not lost. Only a short date-shaped line is
 * rejoined, and only when neither line holds a range of its own and together they do: "Senior
 * Engineer, 23andMe" over "2018 - 2019" is a header over its dates, not a wrapped range.
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
    // A row whose two sides both wrap: "Engineer, Alpine Ski House⇥Jul 2003 – May" over
    // "Systems⇥2008". Each side is rejoined with its own continuation.
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
