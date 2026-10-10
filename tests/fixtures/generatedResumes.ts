/**
 * Seeded synthetic resumes for `npm run bench`, labelled from the inputs they are written from,
 * never from what the engine reads. People, employers and schools are invented, drawn from small
 * hand-written lists. Layout varies the way real resumes do: how a job's title, employer and dates
 * are joined, where the date and the city go, how dates are written, which heading synonym and
 * section order, which bullet. The same resume is rendered as text, as a one-column PDF with
 * flush-right dates (over several pages when it is long), as a two-column PDF with a sidebar, and
 * as a DOCX, so reading order, columns and page breaks are measured too.
 *
 * Deterministic: a seed gives the same corpus on every machine. Change a list or the order the
 * generator draws in and every resume changes, so the baseline in bench/baseline.json is redone.
 */
import { extractResume } from "../../src/node/extract.js";
import { buildDocx } from "./buildDocx.js";
import { buildPdfPages, text } from "./buildPdf.js";
import type { LocaleFixture } from "./locale-resumes.js";

export type Rendering = "text" | "pdf" | "pdf-2col" | "docx";
export const RENDERINGS: readonly Rendering[] = ["text", "pdf", "pdf-2col", "docx"];

/** One printed line. `right`, when present, is what a PDF sets flush right. */
type Line = {
  left: string;
  right?: string;
  glue?: string;
  /** Header lines that hold several details; a sidebar sets each on its own line. */
  parts?: string[];
};
type Block = {
  kind: "experience" | "education" | "skills" | "certifications" | "summary";
  heading: string;
  lines: Line[];
  /** The same entries as a narrow sidebar sets them: a line per detail, so a wrap splits no name. */
  narrow?: Line[];
};

export type GeneratedResume = LocaleFixture & {
  /** The name, contact lines and sections, in page order, for the renderers. */
  header: Line[];
  blocks: Block[];
};

/** mulberry32: a 32-bit seeded generator, small and good enough to vary a layout. */
function mulberry32(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = [
  "Maya",
  "Jonas",
  "Priya",
  "Tomas",
  "Elena",
  "Marcus",
  "Leila",
  "Owen",
  "Sofia",
  "Daniel",
  "Nadia",
  "Felix",
];
const LAST = [
  "Alvarez",
  "Brandt",
  "Chowdhury",
  "Donovan",
  "Eriksen",
  "Farouk",
  "Grayson",
  "Holloway",
  "Ibarra",
  "Jansen",
  "Kowalski",
  "Lindqvist",
];
const EMPLOYERS = [
  "Lakeside Retail",
  "Brightwave Labs",
  "Harborview Health",
  "Copperline Systems",
  "Stonebridge Logistics",
  "Fernhill Analytics",
  "Ironwood Media",
  "Redcrest Energy",
  "Bluepine Software",
  "Summit Ridge Bank",
  "Oakmont Foods",
  "Tidewater Robotics",
  "Quarry Lane Studios",
  "Alder Point Insurance",
];
const SUFFIXES = ["", "", "", " Ltd", " Inc"];
const TITLES = [
  "Software Engineer",
  "Senior Software Engineer",
  "Data Analyst",
  "Product Manager",
  "Project Manager",
  "Systems Administrator",
  "Business Analyst",
  "Operations Manager",
  "UX Designer",
  "DevOps Engineer",
  "Marketing Manager",
  "Solutions Architect",
];
const SCHOOLS = [
  "Eastbrook University",
  "University of Lakemont",
  "Pinecrest Institute of Technology",
  "Westfield State University",
  "University of Northgate",
  "Marlow University",
];
const DEGREES = [
  { credential: "B.S.", field: "Computer Science", isced: 6 },
  { credential: "BSc", field: "Economics", isced: 6 },
  { credential: "Bachelor of Science", field: "Statistics", isced: 6 },
  { credential: "B.A.", field: "Business Administration", isced: 6 },
  { credential: "M.S.", field: "Data Science", isced: 7 },
  { credential: "Master of Science", field: "Information Systems", isced: 7 },
  { credential: "Master of Arts", field: "Public Policy", isced: 7 },
];
const CITIES: Array<[string, string]> = [
  ["Denver", "CO"],
  ["Austin", "TX"],
  ["Portland", "OR"],
  ["Madison", "WI"],
  ["Raleigh", "NC"],
  ["Tucson", "AZ"],
];
const SKILLS = [
  "Python",
  "SQL",
  "Kubernetes",
  "Terraform",
  "TypeScript",
  "PostgreSQL",
  "Tableau",
  "Excel",
  "Docker",
  "Figma",
  "Airflow",
  "Kafka",
  "Salesforce",
  "Jira",
];
const CERTS = [
  { name: "AWS Certified Cloud Practitioner", issuer: "Amazon Web Services" },
  { name: "Certified Scrum Master", issuer: "Scrum Alliance" },
  { name: "Project Management Professional (PMP)", issuer: "PMI" },
  { name: "Google Data Analytics Professional Certificate", issuer: "Coursera" },
];
const BULLETS = [
  "Built the reporting pipeline that twelve teams rely on every week",
  "Cut the monthly close from ten days to four by automating reconciliations",
  "Led a team of five through a migration to a new platform",
  "Introduced code review and release checklists across the group",
  "Reduced support tickets by a quarter with a self-service dashboard",
  "Negotiated vendor contracts that saved six figures a year",
  "Mentored three junior colleagues into their first promotion",
  "Ran weekly planning with design, sales and operations",
];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HEADINGS = {
  experience: [
    "Experience",
    "Work Experience",
    "Professional Experience",
    "Employment History",
    "Relevant Experience",
  ],
  education: ["Education", "Educational Background", "Academic Background"],
  skills: ["Skills", "Technical Skills", "Core Competencies", "Technologies"],
  certifications: ["Certifications", "Licenses & Certifications"],
  summary: ["Summary", "Profile"],
};

/**
 * How a job's title, employer and dates (`right`, with the city when it goes there) are set: on
 * one line, joined by a separator, the dates flush right; or on lines of their own.
 */
type RoleStyle = (title: string, employer: string, right: string, city: string) => Line[];
/** The employer with the city flush right, then the title with the dates flush right. */
const EMPLOYER_CITY_THEN_TITLE_DATES: RoleStyle = (title, employer, dates, city) => [
  { left: employer, right: city, glue: "\t" },
  { left: title, right: dates, glue: "\t" },
];
const ROLE_STYLES: readonly RoleStyle[] = [
  (title, employer, right) => [{ left: `${title} | ${employer}`, right, glue: " | " }],
  (title, employer, right) => [{ left: `${title}, ${employer}`, right, glue: "    " }],
  (title, employer, right) => [{ left: `${title} — ${employer}`, right, glue: " — " }],
  (title, employer, right) => [{ left: `${title} at ${employer}`, right, glue: ", " }],
  (title, employer, right) => [{ left: `${title}\t${employer}`, right, glue: "\t" }],
  (title, employer, right) => [{ left: `${employer} | ${title}`, right, glue: " | " }],
  (title, employer, right) => [{ left: `${employer} — ${title}`, right, glue: " — " }],
  (title, employer, right) => [{ left: employer }, { left: title }, { left: right }],
  (title, employer, right) => [{ left: title }, { left: employer }, { left: right }],
  EMPLOYER_CITY_THEN_TITLE_DATES,
];

type Ym = { year: number; month: number };
type DateForm = "mon" | "slash" | "iso" | "year";

export function generateResumes(count: number, seed = 20261001): GeneratedResume[] {
  const rand = mulberry32(seed);
  const int = (n: number) => Math.floor(rand() * n);
  const pick = <T>(items: readonly T[]): T => items[int(items.length)]!;
  const chance = (p: number) => rand() < p;
  const some = <T>(items: readonly T[], n: number): T[] => {
    const pool = [...items];
    return Array.from({ length: n }, () => pool.splice(int(pool.length), 1)[0]!);
  };
  return Array.from({ length: count }, (_, index) => build(index));

  function build(index: number): GeneratedResume {
    const first = pick(FIRST);
    const last = pick(LAST);
    const name = `${first} ${last}`;
    const email = `${first}.${last}@example.com`.toLowerCase();
    const area = pick(["415", "212", "206", "312", "617"]);
    const line = String(100 + int(100));
    const phone = pick([
      `+1 ${area} 555 0${line}`,
      `(${area}) 555-0${line}`,
      `${area}-555-0${line}`,
    ]);
    const [town, state] = pick(CITIES);
    const city = `${town}, ${state}`;
    const form: DateForm = pick(["mon", "mon", "slash", "iso", "year"]);
    const rangeWord = pick([" – ", " - ", " to "]);
    const currentWord = pick(["Present", "Current"]);
    const upper = chance(0.3);
    const bulletMark = pick(["•", "-", "*", "–"]);
    const style = pick(ROLE_STYLES);
    // Where the city goes, unless the style sets it beside the employer itself.
    const where =
      style === EMPLOYER_CITY_THEN_TITLE_DATES
        ? "none"
        : pick(["none", "own", "dates", "employer"] as const);

    const fmt = (d: Ym) =>
      form === "mon"
        ? `${MONTHS[d.month - 1]} ${d.year}`
        : form === "slash"
          ? `${String(d.month).padStart(2, "0")}/${d.year}`
          : form === "iso"
            ? `${d.year}-${String(d.month).padStart(2, "0")}`
            : `${d.year}`;
    const label = (d: Ym) =>
      form === "year" ? `${d.year}` : `${d.year}-${String(d.month).padStart(2, "0")}`;

    // Roles, newest first: each starts the month after the one before it ended.
    const roleCount = 2 + int(2);
    const currentJob = chance(0.6);
    let end: Ym = currentJob ? { year: 2026, month: 9 } : { year: 2025, month: 1 + int(12) };
    const employers = some(EMPLOYERS, roleCount);
    const roles = Array.from({ length: roleCount }, (_, i) => {
      const months = 24 + int(25);
      const total = end.year * 12 + end.month - 1 - months;
      const start = { year: Math.floor(total / 12), month: (total % 12) + 1 };
      const role = {
        title: pick(TITLES),
        employer: employers[i]! + pick(SUFFIXES),
        start,
        end,
        current: i === 0 && currentJob,
        bullets: some(BULLETS, 2 + int(2)),
      };
      const before = total - 1;
      end = { year: Math.floor(before / 12), month: (before % 12) + 1 };
      return role;
    });

    const oldest = roles[roles.length - 1]!.start.year;
    const degreeCount = chance(0.35) ? 2 : 1;
    const degrees = some(SCHOOLS, degreeCount).map((school, i) => {
      const degree =
        i === 0
          ? pick(DEGREES.filter((d) => d.isced === 6))
          : pick(DEGREES.filter((d) => d.isced === 7));
      return { school, ...degree, year: oldest - 1 - (degreeCount === 2 ? 2 - i * 2 : 0) };
    });
    // Newest first.
    degrees.sort((a, b) => b.year - a.year);

    const skills = some(SKILLS, 5 + int(3));
    const certs = chance(0.35)
      ? some(CERTS, 1 + int(2)).map((cert) => ({ ...cert, kind: int(3) }))
      : [];
    const links = some(
      [
        "linkedin.com/in/" + `${first}-${last}`.toLowerCase(),
        "github.com/" + `${first}${last}`.toLowerCase(),
        "https://www.linkedin.com/in/" + `${first}${last}`.toLowerCase(),
      ],
      int(3),
    );

    const cased = (heading: string) => (upper ? heading.toUpperCase() : heading);
    const dateRange = (r: (typeof roles)[number]) =>
      `${fmt(r.start)}${rangeWord}${r.current ? currentWord : fmt(r.end)}`;

    // Experience.
    const experience: Line[] = [];
    for (const role of roles) {
      const dates = dateRange(role);
      const employer = where === "employer" ? `${role.employer}, ${city}` : role.employer;
      const right = where === "dates" ? `${city}    ${dates}` : dates;
      experience.push(...style(role.title, employer, right, city));
      if (where === "own") experience.push({ left: city });
      for (const bullet of role.bullets) experience.push({ left: `${bulletMark} ${bullet}` });
    }

    // Education.
    const eduStyle = int(3);
    const education: Line[] = [];
    const stacked: Line[] = [];
    for (const d of degrees) {
      const study =
        d.credential.length > 5 && chance(0.5)
          ? `${d.credential} in ${d.field}`
          : `${d.credential} ${d.field}`;
      if (eduStyle === 0) education.push({ left: `${d.school}, ${study}, ${d.year}` });
      else if (eduStyle === 1) education.push({ left: `${study} | ${d.school} | ${d.year}` });
      else education.push({ left: d.school }, { left: `${study}, ${d.year}` });
      stacked.push({ left: d.school }, { left: `${study}, ${d.year}` });
    }

    // Skills.
    const skillStyle = int(3);
    const skillLines: Line[] =
      skillStyle === 0
        ? [{ left: skills.join(", ") }]
        : skillStyle === 1
          ? [{ left: skills.join(" | ") }]
          : skills.map((s) => ({ left: `${bulletMark} ${s}` }));

    // Certifications.
    const certLines: Line[] = [];
    const certExpected: NonNullable<LocaleFixture["certifications"]> = [];
    for (const cert of certs) {
      const year = 2020 + int(5);
      const m = 1 + int(12);
      if (cert.kind === 0) {
        certLines.push({ left: `${cert.name}, ${cert.issuer}, ${year}` });
        certExpected.push({ name: cert.name, issuer: cert.issuer, date: `${year}`, expires: "" });
      } else if (cert.kind === 1) {
        const issued = `${MONTHS[m - 1]} ${year}`;
        const expires = `${MONTHS[m - 1]} ${year + 3}`;
        certLines.push({
          left: `${cert.name} | ${cert.issuer} | Issued ${issued} | Expires ${expires}`,
        });
        certExpected.push({
          name: cert.name,
          issuer: cert.issuer,
          date: `${year}-${String(m).padStart(2, "0")}`,
          expires: `${year + 3}-${String(m).padStart(2, "0")}`,
        });
      } else {
        certLines.push({ left: `${cert.name} (${cert.issuer}), expires ${year + 3}` });
        certExpected.push({
          name: cert.name,
          issuer: cert.issuer,
          date: "",
          expires: `${year + 3}`,
        });
      }
    }

    // Header lines.
    const contact = [email, phone, ...(chance(0.5) ? [city] : [])];
    const headerStyle = int(3);
    const header: Line[] = [{ left: name }];
    if (headerStyle === 0) header.push({ left: contact.join(" | "), parts: contact });
    else if (headerStyle === 1) header.push({ left: contact.join("  "), parts: contact });
    else header.push(...contact.map((left) => ({ left })));
    if (links.length) header.push({ left: links.join(chance(0.5) ? " | " : "  "), parts: links });

    const blocks: Block[] = [];
    const sections: Array<Block["kind"]> = [
      "experience",
      "education",
      "skills",
      ...(certs.length ? (["certifications"] as const) : []),
    ];
    // Section order varies; a summary, when there is one, comes first.
    for (let i = sections.length - 1; i > 0; i -= 1) {
      const j = int(i + 1);
      [sections[i], sections[j]] = [sections[j]!, sections[i]!];
    }
    if (chance(0.5))
      blocks.push({
        kind: "summary",
        heading: cased(pick(HEADINGS.summary)),
        lines: [{ left: "Dependable professional with a record of steady delivery." }],
      });
    for (const kind of sections)
      blocks.push({
        kind,
        heading: cased(pick(HEADINGS[kind])),
        narrow: kind === "education" ? stacked : undefined,
        lines: {
          experience,
          education,
          skills: skillLines,
          certifications: certLines,
          summary: [],
        }[kind],
      });

    return {
      id: `gen-${String(index + 1).padStart(2, "0")}`,
      text: "",
      locale: { languages: [], region: null },
      name,
      email,
      phone,
      links,
      roles: roles.map((r) => ({
        title: r.title,
        employer: r.employer,
        start: label(r.start),
        end: r.current ? "" : label(r.end),
        current: r.current,
      })),
      education: degrees.map((d) => ({
        school: d.school,
        isced: d.isced,
        credential: d.credential,
      })),
      skills,
      certifications: certExpected,
      header,
      blocks,
    };
  }
}

const joined = (line: Line) =>
  line.right === undefined ? line.left : `${line.left}${line.glue ?? "    "}${line.right}`;

/** Every line in page order, a heading on a line of its own. */
function lines(resume: GeneratedResume): string[] {
  return [
    ...resume.header.map(joined),
    ...resume.blocks.flatMap((block) => [block.heading, ...block.lines.map(joined)]),
  ];
}

/** Helvetica is not embedded; the standard encoding's bullet and dashes are bytes 0xB7, 0xB1, 0xD0. */
const pdfSafe = (value: string) =>
  value.replace(/•/g, "·").replace(/–/g, "±").replace(/—/g, "Ð").replace(/\t/g, "    ");

const wrap = (value: string, width: number): string[] => {
  const out: string[] = [];
  let current = "";
  for (const word of value.split(" ")) {
    if (current && current.length + 1 + word.length > width) {
      out.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  return [...out, current];
};

/** Helvetica advance widths (AFM, per 1000 em) for characters 32 to 126, in order. */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 222, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 222, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
/** The bytes `pdfSafe` writes for a bullet and the en and em dashes. */
const SPECIAL: Record<string, number> = { "·": 350, "±": 556, Ð: 1000 };
const width = (value: string, size = 10) =>
  ([...value].reduce(
    (sum, char) => sum + (SPECIAL[char] ?? WIDTHS[char.charCodeAt(0) - 32] ?? 556),
    0,
  ) *
    size) /
  1000;
/** Where a run starts so its right edge is exactly `edge`, as a right tab or justify-between does. */
const flushRight = (right: string, edge: number) => Math.round((edge - width(right)) * 100) / 100;

/** One column, dates flush right, a new page when a page is full. */
function pdfOneColumn(resume: GeneratedResume): Buffer {
  const pages: string[][] = [[]];
  let y = 750;
  const put = (x: number, value: string, step = 13) => {
    if (y < 60) {
      pages.push([]);
      y = 750;
    }
    pages[pages.length - 1]!.push(text(x, y, pdfSafe(value)));
    y -= step;
  };
  const row = (line: Line) => {
    if (line.right === undefined) return put(50, line.left);
    const at = y;
    put(50, line.left, 0);
    y = at;
    put(flushRight(pdfSafe(line.right), 562), line.right);
  };
  resume.header.forEach((line, i) => put(50, line.left, i === 0 ? 20 : 13));
  for (const block of resume.blocks) {
    y -= 8;
    put(50, block.heading, 16);
    block.lines.forEach(row);
  }
  return buildPdfPages(pages.map((ops) => ops.join("\n")));
}

/**
 * A sidebar (contact, skills, education) beside a main column (summary, experience,
 * certifications). A job's dates go on a line of their own when they would not fit beside it.
 */
function pdfTwoColumn(resume: GeneratedResume): Buffer {
  const ops: string[] = [];
  ops.push(text(40, 750, pdfSafe(resume.header[0]!.left)));
  let side = 715;
  const putSide = (value: string, step = 13) => {
    for (const piece of wrap(value, 36)) {
      ops.push(text(40, side, pdfSafe(piece)));
      side -= step;
    }
  };
  for (const line of resume.header.slice(1))
    for (const part of line.parts ?? [line.left]) putSide(part);
  let main = 715;
  const putMain = (value: string, x = 262, step = 13) => {
    ops.push(text(x, main, pdfSafe(value)));
    main -= step;
  };
  for (const block of resume.blocks) {
    if (block.kind === "education" || block.kind === "skills") {
      side -= 8;
      putSide(block.heading, 16);
      for (const line of block.narrow ?? block.lines) putSide(joined(line));
      continue;
    }
    main -= 8;
    putMain(block.heading, 262, 16);
    for (const line of block.lines) {
      if (line.right === undefined) for (const piece of wrap(line.left, 62)) putMain(piece);
      else if (line.left.length + line.right.length > 56) {
        putMain(line.left);
        putMain(line.right);
      } else {
        const at = main;
        putMain(line.left, 262, 0);
        main = at;
        putMain(line.right, flushRight(pdfSafe(line.right), 580));
      }
    }
  }
  return buildPdfPages([ops.join("\n")]);
}

export type Rendered = {
  text: string;
  layout?: Awaited<ReturnType<typeof extractResume>>["layout"];
};

/** The text an ATS reads from the resume in a rendering, with the layout signals of a file. */
export async function renderResume(
  resume: GeneratedResume,
  rendering: Rendering,
): Promise<Rendered> {
  if (rendering === "text") return { text: lines(resume).join("\n") };
  const file =
    rendering === "pdf"
      ? pdfOneColumn(resume)
      : rendering === "pdf-2col"
        ? pdfTwoColumn(resume)
        : // In Word, the gap before a flush-right city or date is a tab, not a run of spaces.
          buildDocx(lines(resume).map((line) => line.replace(/ {2,}/g, "\t")));
  const { text: read, layout } = await extractResume(file, rendering === "docx" ? "docx" : "pdf");
  return { text: read, layout };
}
