import type { AtsEnginePolicy } from "../policy/schema.js";
import { despaceLines, isBareSectionHeading } from "./sections.js";

/**
 * The first word of a wrapped line's continuation: entirely lowercase. "iOS Engineer" and "eBay"
 * are lowercase-initial too, and they start lines of their own.
 */
const CONTINUATION = /^\p{Ll}+(?![\p{L}\p{N}])/u;

/**
 * Lines broken only because the page ran out of width, joined back into the line they belong to.
 *
 * Text extracted from a PDF breaks every paragraph and every long bullet where the page wrapped
 * it, and a line-based reader then counts one bullet as two — the second of which never opens
 * with an action verb, carries the number the first lacks, or reads as a header beside a date.
 * A continuation is recognised by two things a new line almost never has together: the line
 * before it runs near the full width of the text, without ending a sentence, and it opens with a
 * lowercase word. A wrap at a hyphen ("real-" / "time") is rejoined without a space. A line
 * that is a section heading by itself ("experience", "skills") is never a continuation: glued
 * onto the line above, the section it opens was lost.
 */
function joinWrapped(lines: string[], policy: AtsEnginePolicy): string[] {
  const lengths = lines.map((line) => line.length).sort((a, b) => a - b);
  const fullWidth = Math.max(40, (lengths[Math.floor(lengths.length * 0.9)] ?? 0) * 0.6);

  const joined: string[] = [];
  for (const line of lines) {
    const last = joined.length - 1;
    const previous = joined[last];
    if (
      previous !== undefined &&
      previous.length >= fullWidth &&
      !/[.!?]$/.test(previous) &&
      CONTINUATION.test(line) &&
      !isBareSectionHeading(line, policy)
    )
      joined[last] = previous.endsWith("-") ? previous + line : `${previous} ${line}`;
    else joined.push(line);
  }
  return joined;
}

/** The opening of an ATX heading ("## Experience"): one to six marks, then a space. */
const MARKDOWN_HEADING = /^#{1,6}[ \t]+/;
/** A thematic break ("---", "* * *", "___"): a rule, not text. */
const MARKDOWN_RULE = /^([-*_])(?:[ \t]*\1){2,}$/;
/** An inline link, `[text](url)`, bounded so a line of unclosed brackets stays linear. */
const MARKDOWN_LINK = /\[([^\]\n]{1,200})\]\(([^)\s]{1,500})\)/g;

/** A heading's text: the marks before it, and any closing run of marks after a space, removed. */
function headingText(line: string, opening: number): string {
  const text = line.slice(opening).trimEnd();
  let end = text.length;
  while (end > 0 && text[end - 1] === "#") end -= 1;
  return end < text.length && (end === 0 || text[end - 1] === " " || text[end - 1] === "\t")
    ? text.slice(0, end).trimEnd()
    : text;
}

/**
 * A line of Markdown as its reader sees it. `#` and `*` are list markers to the line reader, so a
 * "## Experience" heading read as a bullet and the section it opened was lost. Heading marks and
 * rules go; `**bold**` and `__bold__` lose their marks when they come in pairs; a link keeps its
 * text and its target. "C#", "#1" and "snake_case" are not Markdown and are left as they are.
 */
function readMarkdown(line: string): string {
  if (MARKDOWN_RULE.test(line)) return "";
  const heading = MARKDOWN_HEADING.exec(line);
  let text = heading ? headingText(line, heading[0].length) : line;
  for (const mark of ["**", "__"]) {
    const parts = text.split(mark);
    // An odd number of parts is an even number of marks: every one has its pair.
    if (parts.length > 1 && parts.length % 2 === 1) text = parts.join("");
  }
  if (!text.includes("](")) return text;
  return text.replace(MARKDOWN_LINK, (_, label: string, href: string) => {
    const target = href.replace(/^mailto:/i, "");
    return label.trim() === target ? target : `${label} ${target}`;
  });
}

/**
 * A resume's trimmed, non-empty lines, read the way a person reads them: wrapped lines rejoined
 * and letter-spaced ones read back as words, Markdown read past. `spaced` counts the latter for the letter-spacing
 * rule. Run once per resume: the wrap threshold is measured on the lines it is given.
 */
export function readResumeLines(lines: string[], policy: AtsEnginePolicy) {
  return despaceLines(
    joinWrapped(lines.map((line) => readMarkdown(line.trim()).trim()).filter(Boolean), policy),
    policy,
  );
}
