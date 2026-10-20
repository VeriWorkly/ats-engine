import type { AtsEnginePolicy } from "../policy/schema.js";
import { despaceLines, isBareSectionHeading } from "./sections.js";

/** The first word of a wrapped line's continuation: entirely lowercase ("iOS", "eBay" start lines). */
const CONTINUATION = /^\p{Ll}+(?![\p{L}\p{N}])/u;

/**
 * Lines broken only because the page ran out of width, joined back. A continuation is a line
 * after one that runs near the full text width without ending a sentence, opening with a
 * lowercase word. A hyphen wrap ("real-" / "time") rejoins without a space. A bare section
 * heading is never a continuation.
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
 * A line of Markdown as its reader sees it (`#` and `*` would read as list markers). Heading
 * marks and rules go; paired `**`/`__` lose their marks; a link keeps its text and target. "C#",
 * "#1" and "snake_case" are left alone.
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
 * A resume's trimmed, non-empty lines as a person reads them: wrapped lines rejoined, letter-spaced
 * ones read back as words, Markdown read past. `spaced` counts the latter for the letter-spacing
 * rule. Run once per resume: the wrap threshold is measured on the lines given.
 */
export function readResumeLines(lines: string[], policy: AtsEnginePolicy) {
  return despaceLines(
    joinWrapped(lines.map((line) => readMarkdown(line.trim()).trim()).filter(Boolean), policy),
    policy,
  );
}
