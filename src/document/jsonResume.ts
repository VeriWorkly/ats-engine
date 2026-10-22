import {
  ATS_DOCUMENT_FORMAT,
  DOCUMENT_LIMITS,
  type AtsDocumentEntry,
  type AtsDocumentSection,
  type AtsResumeDocument,
} from "./types.js";

// JSON Resume (https://jsonresume.org/schema) -> `AtsResumeDocument`. Files are loosely followed,
// so every field is read defensively: a value of the wrong type is absent, a lone value where the
// schema has a list is a list of one. The schema has no section headings, so English defaults are
// used, in print order.

type Json = Record<string, unknown>;
/** What an empty entry reads as. */
type Empty = false | "" | 0 | null | undefined;

const title = {
  summary: "Summary",
  work: "Experience",
  volunteer: "Volunteering",
  education: "Education",
  projects: "Projects",
  skills: "Skills",
  awards: "Awards",
  certificates: "Certifications",
  publications: "Publications",
  languages: "Languages",
  interests: "Interests",
  references: "References",
};

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const MAX_ITEMS = DOCUMENT_LIMITS.items;
const MAX_LINES = DOCUMENT_LIMITS.lines;
const MAX_KEYWORDS = DOCUMENT_LIMITS.keywords;

const str = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/**
 * Two to five capitalised words, or words of a script without case, or one run of two to four Han
 * or Hangul ("王小明"): a person's name.
 */
const NAME =
  /^(?:[\p{Lu}\p{Lo}]\S*(?:\s+\S+){0,5}\s+[\p{Lu}\p{Lo}]\S*|[\p{sc=Han}\p{sc=Hangul}]{2,4})$/u;

/**
 * The entries of a list as `read` reads them, empty ones (falsy) dropped, up to `max`: the limit
 * of the document field they fill, as the schema rejects an over-long list. Empty entries are
 * dropped before the cut, so 200 of them hide no real one, and the walk stops at `max` kept.
 */
function list<T>(value: unknown, max: number, read: (item: unknown) => T | Empty) {
  const kept: T[] = [];
  for (const item of Array.isArray(value) ? value : [value]) {
    if (kept.length >= max) break;
    const entry = read(item);
    if (entry) kept.push(entry);
  }
  return kept;
}

const strings = (value: unknown, max: number) => list(value, max, str);

const objects = <T>(value: unknown, read: (item: Json) => T | Empty) =>
  list(value, MAX_ITEMS, (item) => isObject(item) && read(item));

/**
 * Whether an object reads as a JSON Resume. Keyed on what is distinctive to the schema: `work`
 * with `basics`, a role with a `position` without, or an education entry with an `institution`
 * is required, and `basics.fullName` (another format's spelling) rules it out.
 */
export function isJsonResume(value: unknown): value is Record<string, unknown> {
  if (!isObject(value) || "format" in value) return false;
  const { basics, work } = value;
  const names = (items: unknown, key: string) =>
    [items].flat().some((item) => isObject(item) && typeof item[key] === "string");
  return isObject(basics)
    ? !("fullName" in basics) && (typeof work === "object" || names(value.education, "institution"))
    : names(work, "position") || names(value.education, "institution");
}

/** How hand-written files say a role is current instead of omitting the end. */
const PRESENT = /^(?:present|current|now|ongoing|to date|till date)$/i;

/** JSON Resume allows YYYY-MM-DD and full ISO datetimes; the document contract is YYYY-MM. */
function date(value: unknown) {
  const raw = str(value);
  if (PRESENT.test(raw)) return undefined;
  const match = /^(\d{4})(?:-(\d{1,2}))?(?:-\d{1,2})?(?:T.*)?$/.exec(raw);
  if (!match) return raw || undefined;
  return match[2] ? `${match[1]}-${match[2].padStart(2, "0")}` : match[1];
}

/** Current when there is a start and the end is absent or says "present". */
const isCurrent = (item: Json) =>
  Boolean(str(item.startDate)) && (!str(item.endDate) || PRESENT.test(str(item.endDate)));

const optional = (value: string) => value || undefined;

const lineOf = (value: unknown) => (str(value) ? [str(value)] : []);

/** Entries with a heading or a line; one with neither names nothing and is dropped. */
const entries = (
  value: unknown,
  heading: (item: Json) => Array<string | undefined>,
  lines: (item: Json) => string[],
): AtsDocumentEntry[] =>
  objects(value, (item) => {
    const entry = {
      heading: optional(heading(item).filter(Boolean).join(", ")),
      lines: lines(item).slice(0, MAX_LINES),
    };
    return (entry.heading || entry.lines.length) && entry;
  });

/** A JSON Resume as an `AtsResumeDocument` with English section titles, in print order. Never throws. */
export function fromJsonResume(json: unknown): AtsResumeDocument {
  const resume = isObject(json) ? json : {};
  // Basics that are only a string are the name when it has one's shape ("Mira Kestrel"); the engine
  // also holds it to a printed name's checks (`prepareResume`).
  const basics = isObject(resume.basics)
    ? resume.basics
    : { name: NAME.test(str(resume.basics)) && resume.basics };
  const location = isObject(basics.location) ? basics.location : {};

  // A profile without a URL is named by network and username ("GitHub: jdoe").
  const links = [
    str(basics.url),
    ...objects(
      basics.profiles,
      (profile) =>
        str(profile.url) ||
        (str(profile.username) &&
          [str(profile.network), str(profile.username)].filter(Boolean).join(": ")),
    ),
  ]
    .filter(Boolean)
    .slice(0, DOCUMENT_LIMITS.links);

  const sections: AtsDocumentSection[] = [];
  const add = (section: AtsDocumentSection) => {
    if (section.kind === "summary" ? section.text : section.items.length) sections.push(section);
  };

  add({ kind: "summary", title: title.summary, text: str(basics.summary) });

  add({
    kind: "experience",
    title: title.work,
    items: objects(resume.work, (work) => {
      const role = {
        title: str(work.position),
        // `company` is the pre-1.0 schema's name.
        employer: str(work.name) || str(work.company),
        location: optional(str(work.location)),
        start: date(work.startDate),
        end: date(work.endDate),
        current: isCurrent(work),
        summary: optional(str(work.summary) || str(work.description)),
        highlights: strings(work.highlights, MAX_LINES),
      };
      // A role with neither a title nor an employer names nothing.
      return (role.title || role.employer) && role;
    }),
  });

  // Not work history: an ATS files volunteering separately, so it never counts toward tenure.
  add({
    kind: "other",
    title: title.volunteer,
    items: entries(
      resume.volunteer,
      (item) => [
        str(item.position),
        str(item.organization),
        [date(item.startDate), date(item.endDate) ?? (str(item.startDate) ? "Present" : undefined)]
          .filter(Boolean)
          .join(" - "),
      ],
      (item) => [...lineOf(item.summary), ...strings(item.highlights, MAX_LINES)],
    ),
  });

  add({
    kind: "education",
    title: title.education,
    items: objects(resume.education, (education) => {
      const entry = {
        school: str(education.institution),
        credential: optional(str(education.studyType)),
        field: optional(str(education.area)),
        start: date(education.startDate),
        end: date(education.endDate),
        summary: optional(
          [str(education.score), strings(education.courses, MAX_KEYWORDS).join(", ")]
            .filter(Boolean)
            .join("; "),
        ),
      };
      return (entry.school || entry.credential) && entry;
    }),
  });

  add({
    kind: "projects",
    title: title.projects,
    items: objects(
      resume.projects,
      (project) =>
        str(project.name) && {
          name: str(project.name),
          role: optional(strings(project.roles, MAX_ITEMS).join(", ")),
          url: optional(str(project.url)),
          summary: optional(str(project.description)),
          highlights: strings(project.highlights, MAX_LINES),
          skills: strings(project.keywords, MAX_KEYWORDS),
        },
    ),
  });

  add({
    kind: "skills",
    title: title.skills,
    items: objects(resume.skills, (skill) => {
      const group = {
        name: optional(str(skill.name)),
        keywords: strings(skill.keywords, MAX_KEYWORDS),
      };
      return (group.name || group.keywords.length) && group;
    }),
  });

  add({
    kind: "certifications",
    title: title.certificates,
    items: objects(
      resume.certificates,
      (item) =>
        str(item.name) && {
          name: str(item.name),
          issuer: optional(str(item.issuer)),
          date: date(item.date),
          url: optional(str(item.url)),
        },
    ),
  });

  add({
    kind: "other",
    title: title.awards,
    items: entries(
      resume.awards,
      (item) => [str(item.title), str(item.awarder), date(item.date)],
      (item) => lineOf(item.summary),
    ),
  });

  add({
    kind: "other",
    title: title.publications,
    items: entries(
      resume.publications,
      (item) => [str(item.name), str(item.publisher), date(item.releaseDate)],
      (item) => lineOf(item.summary),
    ),
  });

  add({
    kind: "languages",
    title: title.languages,
    items: objects(
      resume.languages,
      (item) =>
        str(item.language) && { language: str(item.language), level: optional(str(item.fluency)) },
    ),
  });

  add({
    kind: "other",
    title: title.interests,
    items: entries(
      resume.interests,
      (item) => [str(item.name)],
      (item) => [strings(item.keywords, MAX_KEYWORDS).join(", ")].filter(Boolean),
    ),
  });

  add({
    kind: "other",
    title: title.references,
    items: entries(
      resume.references,
      (item) => [str(item.name)],
      (item) => lineOf(item.reference),
    ),
  });

  return {
    format: ATS_DOCUMENT_FORMAT,
    basics: {
      name: str(basics.name),
      headline: optional(str(basics.label)),
      email: optional(str(basics.email)),
      phone: optional(str(basics.phone)),
      location: optional([str(location.city), str(location.region)].filter(Boolean).join(", ")),
      links,
    },
    sections,
  };
}
