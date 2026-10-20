import type { AtsEnginePolicy } from "../policy/schema.js";
import { policyRegex } from "../policy/regex.js";
import { BULLET, wordListRegex } from "../text/text.js";
import { memo } from "../util/memo.js";
import { findDateRange } from "./dates.js";
import { degreeLevel } from "./education.js";

export type ResumeSectionKind =
  "experience" | "education" | "skills" | "projects" | "certifications" | "languages" | "other";

/** `headed`: opened by a heading, as opposed to the lines above the first one. */
export type ResumeSection = { kind: ResumeSectionKind; lines: string[]; headed: boolean };

/** A line short enough (up to eight words) and unpunctuated enough to be a heading, not body copy. */
export function isHeadingLine(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 80) return false;
  // "।" (danda) ends a Hindi sentence.
  if (/[.,;।]$/u.test(trimmed)) return false;
  return trimmed.split(/\s+/).length <= 8;
}

/**
 * The section a line opens, if it is a heading, and any content after a colon on it. Shared by
 * the resume and job segmenters. A pattern matching the line's start is not enough:
 * - "Skills: Python, Java" is a heading and content; the part after the colon is kept.
 * - "History of Art BA" continues as prose, so what follows the match must be empty or more title
 *   words: capitalised ("Work Experience Summary") or a connector ("Skills & Tools").
 * - "Education Program Manager, Khan Academy" is a role: a comma or digit after the match rules a
 *   heading out.
 * - "Education Officer" is a job title: a title word after the match rules a heading out, when
 *   the matchers carry the policy's title words.
 *
 * `tail` is what follows the heading words ("Summary" in "Work Experience Summary"); empty for a
 * bare heading.
 */
export function classifyHeading<K>(
  line: string,
  matchers: HeadingMatchers<K>,
): { kind: K; rest: string; tail: string } | null {
  const colon = line.indexOf(":");
  const head = (colon === -1 ? line : line.slice(0, colon)).trim();
  if (!isHeadingLine(head)) return null;

  for (const { kind, re } of matchers.kinds) {
    const match = re.exec(head);
    const tail = match && head.slice(match.index + match[0].length);
    if (tail === null || !isTitleTail(tail, head, matchers.connector)) continue;
    if (matchers.titleWords?.test(tail)) continue;
    return { kind, rest: colon === -1 ? "" : line.slice(colon + 1).trim(), tail: tail.trim() };
  }
  return null;
}

/**
 * The section patterns, and the policy's `headingConnectors` as one whole-word test. With
 * `titleWords`, a heading word followed by a job title is that title, not the heading.
 */
export type HeadingMatchers<K> = {
  kinds: ReadonlyArray<{ kind: K; re: RegExp }>;
  connector: RegExp;
  titleWords?: RegExp;
};

/** `headingConnectors` as a test of one whole word, symbols ("&", "/") included. */
export const headingConnector = memo(
  (rp: AtsEnginePolicy["resumeParse"]) =>
    new RegExp(`^(?:[&/+|-]+|${rp.headingConnectors.join("|")})$`, "iu"),
);

function isTitleTail(tail: string, head: string, connector: RegExp) {
  // The match ended mid-word (including before a Devanagari vowel sign).
  if (/^[\p{L}\p{M}\p{N}]/u.test(tail)) return false;
  // A heading has no employer after a comma and no dates (a role line does). A count in brackets
  // ("Experience (10+ Years)") is the heading's own, unless it is a year.
  if (tail.includes(",") || /\p{N}/u.test(tail.replace(/\([^()]*\)/g, ""))) return false;
  if (/(?<!\p{N})(?:19|20)\p{N}{2}(?!\p{N})/u.test(tail)) return false;
  // An all-lowercase heading gives no capitalisation signal to judge its tail by.
  if (!/\p{Lu}/u.test(head)) return true;
  // Title case ("Skills & Tools") or sentence case ("Education and certifications"); a capitalised
  // word after a lowercase one is prose ("Experience in Python").
  const words = tail.trim().split(/\s+/).filter(Boolean);
  return (
    words.every((word) => connector.test(word) || /^[\p{Lu}\p{N}(]/u.test(word)) ||
    words.every((word) => !/^\p{Lu}/u.test(word))
  );
}

type SectionMatchers = HeadingMatchers<ResumeSectionKind> & {
  titleWords: RegExp;
  schools: RegExp;
};

const matchersOf = memo((rp: AtsEnginePolicy["resumeParse"]): SectionMatchers => ({
  kinds: [
    { kind: "experience", re: policyRegex(rp.sections.experience, "i") },
    { kind: "education", re: policyRegex(rp.sections.education, "i") },
    { kind: "skills", re: policyRegex(rp.sections.skills, "i") },
    { kind: "projects", re: policyRegex(rp.sections.projects, "i") },
    // Schema-defaulted; a hand-built unparsed policy may lack them.
    { kind: "certifications", re: policyRegex(rp.sections.certifications ?? "(?!)", "i") },
    { kind: "languages", re: policyRegex(rp.sections.languages ?? "(?!)", "i") },
    { kind: "other", re: policyRegex(rp.sections.other, "i") },
  ],
  connector: headingConnector(rp),
  titleWords: wordListRegex(rp.titleWords),
  schools: wordListRegex(rp.schoolWords),
}));

const sectionMatchers = (policy: AtsEnginePolicy) => matchersOf(policy.resumeParse);

/** Whether the line is one of the policy's section headings. */
export function isSectionHeading(line: string, policy: AtsEnginePolicy) {
  return classifyHeading(line, sectionMatchers(policy)) !== null;
}

/** The kind of section the line heads, or null when it is not a heading. */
export function sectionKind(line: string, policy: AtsEnginePolicy) {
  return classifyHeading(line, sectionMatchers(policy))?.kind ?? null;
}

/** A heading with content after a colon ("Languages: English (native)") as its kind and content; else null. */
export function labelledLine(line: string, policy: AtsEnginePolicy) {
  const heading = classifyHeading(line, sectionMatchers(policy));
  return heading?.rest ? { kind: heading.kind, rest: heading.rest } : null;
}

/**
 * Whether the line is a heading and nothing more ("experience", "skills: Go"), not one that only
 * opens with a heading word. A lowercase line cannot tell "education" from "education technology"
 * ending a wrapped sentence, so only the bare word is certain.
 */
export function isBareSectionHeading(line: string, policy: AtsEnginePolicy) {
  const colon = line.indexOf(":");
  const head = (colon === -1 ? line : line.slice(0, colon)).trim();
  return (
    isSectionHeading(line, policy) &&
    sectionMatchers(policy).kinds.some(({ re }) => re.exec(head)?.[0].length === head.length)
  );
}

/** The kinds of section a resume has a heading for: exactly the ones `segmentResume` opened. */
export function headedKinds(sections: readonly ResumeSection[]) {
  return new Set(sections.filter((section) => section.headed).map((section) => section.kind));
}

const LETTERS = /^\p{L}+$/u;

/**
 * A letter-spaced line read back as words, or null when the line is not one. Wide tracking on a
 * heading extracts one word per glyph (PDF text has no words; extractors split above ~0.06em):
 * - Wide tracking splits every glyph ("E X P E R I E N C E", kerned pairs left joined):
 *   recognised by shape alone (every fragment one or two letters, nearly all one), which leaves
 *   initials ("J R R Tolkien") alone.
 * - Tracking near the threshold splits some pairs ("SU MMARY"), which also looks like an ordinary
 *   all-caps line ("JANE DOE"): read back only when the result is a heading and the line as
 *   written is not.
 *
 * Word gaps are usually lost too, so "WORKEXPERIENCE" is cut at the fragment gap that makes it a
 * heading. Runs of two or more spaces, where kept, are the word gaps.
 */
function despace(line: string, matchers: SectionMatchers): string | null {
  if (line.length > 80) return null;
  const fragments = line.split(/\s+/);
  if (fragments.length < 2 || !fragments.every((fragment) => LETTERS.test(fragment))) return null;

  const singles = fragments.filter((fragment) => fragment.length === 1).length;
  const glyphPerWord =
    fragments.length >= 4 &&
    fragments.every((fragment) => fragment.length <= 2) &&
    singles / fragments.length >= 0.75;
  if (!glyphPerWord && (line !== line.toUpperCase() || classifyHeading(line, matchers)))
    return null;

  // A tab is a word gap too.
  const words = line.split(/\s{2,}|\t/).map((word) => word.replace(/\s+/g, ""));
  const joined = words.join(" ");
  if (classifyHeading(joined, matchers)) return joined;
  // The lost word gap is one of the printed gaps, never inside a fragment ("SKILLS ET" is wrong).
  let cut = 0;
  if (words.length === 1)
    for (const fragment of fragments.slice(0, -1)) {
      cut += fragment.length;
      const split = `${joined.slice(0, cut)} ${joined.slice(cut)}`;
      if (classifyHeading(split, matchers)) return split;
    }
  return glyphPerWord ? joined : null;
}

/**
 * The resume's lines with letter-spaced ones read back as words, and how many there were. Run
 * first, so every reader sees "EXPERIENCE". The count is reported because another ATS may keep
 * the spaces and file the section under no heading.
 */
export function despaceLines(lines: string[], policy: AtsEnginePolicy) {
  const matchers = sectionMatchers(policy);
  let spaced = 0;
  const read = lines.map((line) => {
    const despaced = despace(line.trim(), matchers);
    if (despaced === null) return line;
    spaced += 1;
    return despaced;
  });
  return { lines: read, spaced };
}

/** A far `now`, only to tell a date from other numbers. */
const UNBOUNDED = new Date(Date.UTC(9000, 0, 1));

const UNKNOWN = { kind: "other", rest: "", tail: "" } as const;

/** Headings never read as a line of a role, however they are set. */
const SECTIONS_OF_THEIR_OWN = new Set<ResumeSectionKind>([
  "experience",
  "education",
  "certifications",
]);

/** One to four words of letters, joined by spaces or "&", "/", "-": "VOLUNTEER WORK". */
const HEADING_WORDS = /^\p{L}+(?:[ &/-]+\p{L}+){0,3}$/u;

/**
 * Headings the policy does not know ("VOLUNTEER WORK"), told by looking like the known ones (in
 * capitals, or every word capitalised, where every known heading is) and holding no job-title,
 * school or degree word. Used only to close an Education section, and only when nothing before the
 * next known heading names a degree or a school outside a job line.
 */
function unknownHeadings(
  lines: readonly string[],
  headings: ReadonlyArray<unknown>,
  { connector, titleWords, schools }: SectionMatchers,
  policy: AtsEnginePolicy,
) {
  const found = new Set<number>();
  // A heading in the gutter is the first cell of its line.
  const known = lines.filter((_, at) => headings[at]).map((line) => line.split("\t")[0]!);
  if (known.length < 2) return found;
  const capitalised = (line: string) =>
    line
      .trim()
      .split(/\s+/)
      .every((word) => /^\p{Lu}/u.test(word) || connector.test(word));
  const inCapitals = (line: string) => line === line.toUpperCase() && /\p{Lu}/u.test(line);
  const style = known.every(inCapitals)
    ? inCapitals
    : known.every(capitalised)
      ? capitalised
      : null;
  if (!style) return found;

  // Scanned from the end, carrying the next known heading and schooling line, so each candidate is O(1).
  let nextSchooling = Infinity;
  let nextHeading = Infinity;
  for (let at = lines.length - 1; at >= 0; at -= 1) {
    const line = lines[at];
    if (headings[at]) nextHeading = at;
    const school = schools.test(line);
    const title = titleWords.test(line);
    const degree = degreeLevel(line, policy) !== null;
    if (
      !headings[at] &&
      at + 1 < lines.length &&
      nextSchooling >= nextHeading &&
      HEADING_WORDS.test(line) &&
      style(line) &&
      !school &&
      !title &&
      !degree
    )
      found.add(at);
    if (degree || (school && !title)) nextSchooling = at;
  }
  return found;
}

/**
 * Splits the resume at its headings. Every heading ends the previous block, including "other"
 * ones ("Awards"), so a list below the last job is not read as work history.
 *
 * Except inside Skills: "Languages: TypeScript, Go" there is a category of skills, so a heading
 * word with content after its colon stays a skills line. A bare "Languages" still opens a section.
 *
 * A heading in the left gutter, level with its section's first line ("EXPERIENCE⇥Senior
 * Engineer, Acme"), opens its section with the rest of the line as that first line.
 *
 * A heading word plus a word that joins no heading ("Experience Strategist") over bare dates is a
 * role. Education is closed by a heading the policy does not know (`unknownHeadings`).
 */
export function segmentResume(lines: string[], policy: AtsEnginePolicy): ResumeSection[] {
  const matchers = sectionMatchers(policy);
  // Bare dates, with at most a word around them ("Volunteer⇥Jan 2016 - Dec 2019").
  const bareDates = (line: string) => {
    const found = findDateRange(line, policy.resumeParse, UNBOUNDED);
    return found && !/\p{L}{3}/u.test(line.replace(found.matched, " "));
  };
  // A bare heading in a line's first (tab-joined) cell is the heading, the rest the section's first
  // line, on a page that sets two or more headings there and more than stand alone. Elsewhere it
  // is a role's title ("Volunteer⇥Red Cross⇥2016 - 2019"), a role line or a skills table row;
  // beside bare dates always a title.
  const cells = lines.map((line) => {
    const tab = line.indexOf("\t");
    const cell = tab === -1 ? null : classifyHeading(line.slice(0, tab), matchers);
    const rest = line.slice(tab + 1).trim();
    return cell && !cell.tail && !cell.rest && !bareDates(rest) ? { ...cell, rest } : null;
  });
  const plain = lines.map((line, at) => {
    const heading = classifyHeading(line, matchers);
    if (!heading?.tail) return heading;
    // More heading words ("& Certifications", "Summary") make a longer heading.
    const [first] = heading.tail.split(/\s+/);
    if (matchers.connector.test(first) || classifyHeading(heading.tail, matchers)) return heading;
    // Any other word over bare dates is an unlisted job title: no section opens on dates alone.
    return bareDates(lines[at + 1] ?? "") ? null : heading;
  });
  const inGutter = cells.filter(Boolean).length;
  const gutter = inGutter >= 2 && inGutter > plain.filter((h, at) => h && !cells[at]).length;
  const headings = plain.map((heading, at) => (gutter && cells[at]) || heading);
  const gutters = (at: number) => gutter && cells[at] !== null;
  // Whether a heading is set like the page's other headings: capitals, capitalised words, or a
  // colon, where they all are.
  const own = lines.flatMap((line, at) => (headings[at] && !gutters(at) ? [line] : []));
  const styles = [
    (line: string) => !line.includes(":"),
    (line: string) => line === line.toUpperCase(),
    (line: string) =>
      line
        .replace(/:.*/u, "")
        .trim()
        .split(/\s+/)
        .every((word) => /^\p{Lu}/u.test(word) || matchers.connector.test(word)),
  ];
  const counts = styles.map((style) => own.filter(style).length);
  const styled = (line: string) =>
    styles.every(
      (style, at) => style(line) || counts[at]! - +style(line) < own.length - 1 || own.length < 2,
    );
  const unknown = unknownHeadings(lines, headings, matchers, policy);
  // Whether a dated non-bullet line follows each line before the next heading; computed lazily.
  let dated: boolean[] | undefined;
  const datedAfter = (at: number) => {
    if (!dated) {
      dated = [];
      for (let line = lines.length - 1, seen = false; line >= 0; line -= 1) {
        dated[line] = seen;
        if (headings[line]) seen = false;
        else if (!BULLET.test(lines[line]!))
          seen ||= findDateRange(lines[line]!, policy.resumeParse, UNBOUNDED) !== null;
      }
    }
    return dated[at];
  };
  // A list under a role, then the next role: a heading of two words or more with bullets right
  // under it and a job title between the first non-bullet line and its dates, before any heading
  // ("Key Projects" / "- Ledger rewrite" / "Engineer, Globex Inc⇥2016 - 2019"). A bare "PROJECTS"
  // or "SKILLS" opens its section whatever is dated in it.
  const roleAfterList = (at: number) => {
    if (!/\S\s+\S/u.test(lines[at]!.trim()) || !BULLET.test(lines[at + 1] ?? "")) return false;
    for (
      let line = at + 2;
      line < lines.length && !headings[line] && !unknown.has(line);
      line += 1
    ) {
      if (BULLET.test(lines[line]!)) continue;
      if (matchers.titleWords.test(lines[line]!)) return true;
      if (findDateRange(lines[line]!, policy.resumeParse, UNBOUNDED)) return false;
    }
    return false;
  };

  const sections: ResumeSection[] = [];
  let current: ResumeSection = { kind: "other", lines: [], headed: false };

  for (const [at, line] of lines.entries()) {
    // An unknown heading closes Education, and Skills when what is under it is dated.
    const heading =
      headings[at] ??
      (unknown.has(at) &&
      (current.kind === "education" || (current.kind === "skills" && datedAfter(at)))
        ? UNKNOWN
        : null);
    // Inside Skills, a heading with content is a skills category; in the gutter, any but experience and education.
    const category =
      heading?.rest &&
      current.kind === "skills" &&
      heading.kind !== "skills" &&
      (!gutters(at) || (heading.kind !== "experience" && heading.kind !== "education"));
    // Inside experience or projects, with a dated line after it before the next heading, a heading
    // is a line of the role when it names skills with content ("Technologies: React"), is not set
    // like the page's headings, or heads a skills or projects list over the next role. Experience,
    // education and certifications are never a role's lines.
    const inRole =
      headings[at] &&
      !gutters(at) &&
      (current.kind === "experience" || current.kind === "projects") &&
      datedAfter(at) &&
      ((heading!.kind === "skills" && heading!.rest !== "") ||
        (!styled(line) && !SECTIONS_OF_THEIR_OWN.has(heading!.kind)) ||
        ((heading!.kind === "skills" || heading!.kind === "projects") && roleAfterList(at)));
    if (!heading || category || inRole) {
      current.lines.push(line);
      continue;
    }
    if (current.headed || current.lines.length) sections.push(current);
    current = { kind: heading.kind, lines: heading.rest ? [heading.rest] : [], headed: true };
  }
  // An empty section is kept: its heading was still found.
  if (current.headed || current.lines.length) sections.push(current);

  return sections;
}
