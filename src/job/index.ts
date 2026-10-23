/**
 * @veriworkly/ats-engine/job — job posting text from a web page.
 *
 * Parsing only: no fetching. Retrieving a URL safely (SSRF filtering, size and time limits) is
 * the host's job. Dependency-free and runtime-agnostic. Every scan is a forward pass with
 * `indexOf`, never a backtracking regex over the page (see `./html.ts`).
 */

import { decodeEntities, htmlText, indexOfIgnoreCase } from "./html.js";

/** The schema.org `JobPosting` a page publishes, as text: `extractJobPosting`. */
export type AtsJobPosting = {
  title: string;
  company: string;
  /** The posting's own description, as text. */
  description: string;
  /** Requirement fields some sites publish separately from the description. */
  requirements: string[];
};

/**
 * The most of a posting `check` and `analyze` read; `check` says in `parsingWarnings` when it cut
 * one. The helpers here cut only when given `maxChars`, so the cut is made, and reported, once.
 */
export const MAX_JOB_TEXT_CHARS = 20_000;

/** Plain job text: one trimmed line per non-blank line, capped at `maxChars` when given. */
export function normalizeJobText(text: string, maxChars = Number.POSITIVE_INFINITY): string {
  return text
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n")
    .slice(0, maxChars);
}

/**
 * The visible text of an HTML document or fragment, one line per block, as posting text.
 *
 * Block elements become line breaks, so headings and bullets survive as lines. Script, style and
 * the page's furniture (navigation, cookie banners, forms, "similar jobs", hidden elements) are
 * dropped with their content; the posting is read from `<main>` or `<article>` when there is one.
 * An element left unclosed drops everything after it. A `<` that cannot open a tag ("<5k") is
 * text.
 */
export function jobHtmlToText(html: string, maxChars = Number.POSITIVE_INFINITY): string {
  return normalizeJobText(htmlText(html, true), maxChars);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
}

/**
 * `"JobPosting"`, or the type written as a URI or a prefixed name ("http://schema.org/JobPosting").
 */
const isType = (node: Record<string, unknown>, type: string) =>
  asArray(node["@type"]).some(
    (value) => typeof value === "string" && value.split(/[/:#]/).pop() === type,
  );

const isJobPosting = (node: Record<string, unknown>) => isType(node, "JobPosting");

/**
 * Real JSON-LD nests two or three levels; deeper is skipped, as an unbounded walk overflows the
 * stack.
 */
const MAX_JSON_DEPTH = 32;

function textOf(value: unknown, depth = 0): string {
  if (depth > MAX_JSON_DEPTH) return "";
  // JSON-LD descriptions are often HTML escaped once more ("&lt;p&gt;"): unescape, then strip.
  if (typeof value === "string")
    return jobHtmlToText(value.includes("&lt;") ? decodeEntities(value) : value);
  if (Array.isArray(value))
    return value
      .map((item) => textOf(item, depth + 1))
      .filter(Boolean)
      .join("\n");
  if (value && typeof value === "object") {
    const node = value as Record<string, unknown>;
    // A requirement given as structured data: a credential, or experience in months.
    const months = Number(node.monthsOfExperience);
    if (node.name === undefined && node.description === undefined && months > 0)
      return `${Math.round(months / 6) / 2} years of experience`;
    return textOf(node.name ?? node.description ?? node.credentialCategory ?? "", depth + 1);
  }
  return "";
}

/** Every JSON-LD object on the page, with `@graph` containers flattened. */
function jsonLdNodes(html: string): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];
  let index = 0;

  for (;;) {
    const open = indexOfIgnoreCase(html, "<script", index);
    if (open === -1) break;
    const tagEnd = html.indexOf(">", open);
    if (tagEnd === -1) break;
    const close = indexOfIgnoreCase(html, "</script", tagEnd);
    if (close === -1) break;
    index = close + 8;
    if (!html.slice(open, tagEnd).toLowerCase().includes("application/ld+json")) continue;

    // Strip CDATA wrappers; raw line breaks inside strings are retried below as spaces.
    const source = html
      .slice(tagEnd + 1, close)
      .trim()
      .replace(/^(?:\/\/)?<!\[CDATA\[/, "")
      .replace(/(?:\/\/)?\]\]>$/, "");
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      try {
        parsed = JSON.parse(source.replace(/[\n\r\t]/g, " "));
      } catch {
        continue;
      }
    }
    // A cursor, not shift(), and a loop, not push(...spread): both fall over on a big `@graph`.
    const queue = asArray(parsed);
    for (let at = 0; at < queue.length; at += 1) {
      const node = queue[at];
      if (!node || typeof node !== "object" || Array.isArray(node)) continue;
      const record = node as Record<string, unknown>;
      nodes.push(record);
      for (const child of asArray(record["@graph"])) queue.push(child);
    }
  }
  return nodes;
}

/** The schema.org `JobPosting` a page publishes for search engines, or null when it has none. */
export function extractJobPosting(html: string): AtsJobPosting | null {
  const nodes = jsonLdNodes(html);
  const node = nodes.find(isJobPosting);
  if (!node) return null;
  // The employer may be an "@id" reference to an Organization in the graph, else its first one.
  let company = node.hiringOrganization;
  const id = (company as { "@id"?: unknown } | undefined)?.["@id"];
  if (id !== undefined && !textOf(company))
    company =
      nodes.find((other) => other["@id"] === id && textOf(other)) ??
      nodes.find((other) => isType(other, "Organization"));

  const description = textOf(node.description);
  if (!description) return null;

  const requirements = [
    node.qualifications,
    node.skills,
    node.experienceRequirements,
    node.educationRequirements,
    node.responsibilities,
  ]
    .map((value) => textOf(value))
    .filter(Boolean);

  return {
    title: textOf(node.title),
    company: textOf(company),
    description,
    requirements,
  };
}

/** Below this a description is a teaser ("See the full description below"). */
const MIN_POSTING_DESCRIPTION_CHARS = 200;

/**
 * The job text to match a resume against: the page's `JobPosting` when it publishes a real one,
 * its visible text otherwise.
 */
export function jobTextFromHtml(html: string, maxChars = Number.POSITIVE_INFINITY): string {
  const posting = extractJobPosting(html);
  if (!posting || posting.description.length < MIN_POSTING_DESCRIPTION_CHARS)
    return jobHtmlToText(html, maxChars);
  return normalizeJobText(
    [posting.title, posting.company, posting.description, ...posting.requirements].join("\n"),
    maxChars,
  );
}
