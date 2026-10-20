import type { AtsDocumentSection, AtsResumeDocument } from "./types.js";

/** One line: a newline inside a field would split one header into several content lines. */
const clean = (value: string | undefined) => value?.replace(/\s+/g, " ").trim() ?? "";

function join(parts: Array<string | undefined>, separator = ", ") {
  let out = "";
  for (const part of parts) {
    const value = clean(part);
    if (value) out = out ? `${out}${separator}${value}` : value;
  }
  return out;
}

function span(start: string | undefined, end: string | undefined, current: boolean) {
  const from = clean(start);
  const to = current ? "Present" : clean(end);
  return from && to ? `${from} - ${to}` : from || to;
}

function pushBullets(lines: string[], items: string[] | undefined) {
  if (!items) return;
  for (const item of items) {
    const value = clean(item);
    if (value) lines.push(`- ${value}`);
  }
}

function pushText(lines: string[], value: string | undefined) {
  const text = value?.trim();
  if (!text) return;
  // A multi-line summary keeps its line structure.
  for (const line of text.split(/\r?\n/)) if (line.trim()) lines.push(line.trim());
}

function renderSection(section: AtsDocumentSection): string[] {
  const lines: string[] = [];

  switch (section.kind) {
    case "summary":
      pushText(lines, section.text);
      break;
    case "experience":
      for (const role of section.items) {
        const header = join([role.title, role.employer, role.location]);
        if (header) lines.push(header);
        const dates = span(role.start, role.end, Boolean(role.current));
        if (dates) lines.push(dates);
        pushText(lines, role.summary);
        pushBullets(lines, role.highlights);
      }
      break;
    case "education":
      for (const entry of section.items) {
        const line = join([
          entry.school,
          join([entry.credential, entry.field], " in "),
          span(entry.start, entry.end, Boolean(entry.current)),
        ]);
        if (line) lines.push(line);
        pushText(lines, entry.summary);
      }
      break;
    case "projects":
      for (const project of section.items) {
        const header = join([project.name, project.role, project.url]);
        if (header) lines.push(header);
        pushText(lines, project.summary);
        pushBullets(lines, project.highlights);
        if (project.skills?.length) lines.push(join(project.skills));
      }
      break;
    case "skills":
      for (const group of section.items) {
        const keywords = join(group.keywords);
        const name = clean(group.name);
        const line = name && keywords ? `${name}: ${keywords}` : name || keywords;
        if (line) lines.push(line);
      }
      break;
    case "certifications":
      for (const item of section.items) {
        const line = join([item.name, item.issuer, span(item.date, item.expires, false)]);
        if (line) lines.push(line);
      }
      break;
    case "languages": {
      const line = join(
        section.items.map((item) =>
          clean(item.language) && clean(item.level)
            ? `${clean(item.language)} (${clean(item.level)})`
            : item.language,
        ),
      );
      if (line) lines.push(line);
      break;
    }
    case "other":
      for (const entry of section.items) {
        const heading = clean(entry.heading);
        if (heading) lines.push(heading);
        pushBullets(lines, entry.lines);
      }
      break;
  }

  return lines;
}

/**
 * The canonical plain text of a structured resume, as the page prints: one line per visual line,
 * a heading per section, "- " bullets, dates as stored (ISO, so no English month names). What the
 * content rules score and an AI pass reads.
 */
export function renderResumeDocument(doc: AtsResumeDocument): string {
  const { basics } = doc;
  const lines: string[] = [];

  if (clean(basics.name)) lines.push(clean(basics.name));
  if (clean(basics.headline)) lines.push(clean(basics.headline));
  const contact = join(
    [basics.email, basics.phone, basics.location, ...(basics.links ?? [])],
    " | ",
  );
  if (contact) lines.push(contact);

  for (const section of doc.sections) {
    const body = renderSection(section);
    // An empty section prints no heading, or a bare one would satisfy the structure rule.
    if (!body.length) continue;
    lines.push("", ...(clean(section.title) ? [clean(section.title)] : []), ...body);
  }

  return lines.join("\n").trim();
}
