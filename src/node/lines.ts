/**
 * A PDF page's text from pdf.js's positioned items, one line per printed line, in reading order.
 *
 * pdf.js lists text in the order the page paints it, which is not the order it reads in: Chrome
 * paints a floated date before the job title beside it, and a relatively positioned or
 * semi-transparent block after everything else, so a resume printed from a web page came out
 * with every date above the name, or every job below the last heading. So the items are placed
 * by position instead: grouped into lines by baseline, each line read left to right, the lines
 * top to bottom — and on a page with a gutter (`findGutter`), each side of it in turn, band by
 * band between the lines that cross it, so two columns are not interleaved line by line.
 *
 * Within a line: a gap wider than a cell's is a tab, the column gap the parser splits a job title
 * from its employer on (pdf-parse merged them whenever pdf.js reported the gap as one wide
 * space); a narrower one, or a space pdf.js reported, is a space; abutting runs ("Node" ".js",
 * in two fonts) join. A run drawn twice in place — the transparent copy Chrome lays over text
 * with a shadow or an outline — is read once.
 */

import { findGutter, type PositionedRun } from "./layout.js";
import type { Box } from "./surroundings.js";

/** The fields of a pdf.js text item this reads. */
export type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
  hasEOL: boolean;
};

/** Items whose baselines are closer than this, in points, print on one line. */
const LINE_THRESHOLD = 4.6;
/** A gap between two runs on a line wider than this many points, and this many font sizes, is a
 * cell gap: skill tags, a table's columns, a date set apart from its title. */
const CELL_THRESHOLD = 7;
const CELL_EMS = 0.6;

type Placed = { str: string; x: number; y: number; right: number; size: number; blank: boolean };

/** A list marker drawn as a shape — a filled disc or square — rather than as a glyph. */
const MARKED = /^\s*[•●▪■◦○‣∙·*–-]/u;
/** A word set with a space between its letters, as a letter-spaced heading extracts. */
const LETTERED = /^\s*\S(?: \S)+\s*$/u;

/**
 * `pageWidth` lets the page's gutter be found (and is what `columns` measures); `marks` are small
 * filled shapes drawn on the page, in the same viewport space, for the list markers Chrome draws
 * as paths: a line with one just before its first glyph starts with "• ".
 */
export function pageText(
  items: readonly PdfTextItem[],
  toViewport: (x: number, y: number) => number[],
  pageWidth = 0,
  marks: readonly Box[] = [],
): { text: string; columns: number | null } {
  const placed: Placed[] = [];
  for (const item of items) {
    // An empty item only marks where pdf.js saw a line end; position says that here.
    if (!item.str) continue;
    const [x, y] = toViewport(item.transform[4], item.transform[5]);
    placed.push({
      str: item.str,
      x,
      y,
      right: x + item.width,
      size: item.height,
      blank: !item.str.trim(),
    });
  }
  placed.sort((a, b) => a.y - b.y || a.x - b.x);

  const rows: Placed[][] = [];
  for (const item of placed) {
    const row = rows.at(-1);
    if (row && item.y - row[0].y < LINE_THRESHOLD) row.push(item);
    else rows.push([item]);
  }

  const runs: PositionedRun[] = [];
  rows.forEach((row) => {
    for (const { x, right, str, size, blank } of row)
      if (!blank) runs.push({ left: x, right, mass: str.trim().length, row, size });
  });
  const gutter = findGutter(runs, pageWidth);

  let lines = rows;
  if (gutter && gutter.ratio > 0) {
    const { split, tabs } = gutter;
    lines = [];
    let left: Placed[][] = [];
    let right: Placed[][] = [];
    const flush = () => {
      for (const line of left) lines.push(line);
      for (const line of right) lines.push(line);
      left = [];
      right = [];
    };
    for (const row of rows) {
      const solid = row.filter((item) => !item.blank);
      const size = (side: Placed[]) => side.reduce((most, item) => Math.max(most, item.size), 0);
      const [l, r] = [
        solid.filter((item) => item.right <= split),
        solid.filter((item) => item.x >= split),
      ];
      // A line across the gutter — a heading, a rule of text — or one whose right-hand text is a
      // tab stop of its left-hand text ends the band above it and is read whole.
      if (
        l.length + r.length < solid.length ||
        (tabs &&
          l.length &&
          r.length &&
          Math.abs(size(l) - size(r)) <= 0.2 * Math.max(size(l), size(r)))
      ) {
        flush();
        lines.push(row);
        continue;
      }
      const onLeft = (item: Placed) => item.x + item.right < 2 * split;
      const lefts = row.filter(onLeft);
      if (lefts.length) left.push(lefts);
      if (lefts.length < row.length) right.push(row.filter((item) => !onLeft(item)));
    }
    flush();
  } else {
    // No gutter down the page, but a band of lines whose text overlaps vertically — a large
    // name beside a right-aligned contact block, whose first line sits above the name's baseline
    // — is still two blocks side by side: each is read whole, left first, when one has more than
    // one line and a channel no text crosses parts them.
    lines = [];
    const solid = (row: Placed[]) => row.filter((item) => !item.blank);
    for (let at = 0; at < rows.length;) {
      let bottom = solid(rows[at]).reduce((most, item) => Math.max(most, item.y), -Infinity);
      let end = at + 1;
      while (
        end < rows.length &&
        solid(rows[end]).some((item) => item.y - item.size < bottom - 0.5)
      ) {
        for (const item of solid(rows[end])) bottom = Math.max(bottom, item.y);
        end += 1;
      }
      const band = rows.slice(at, end);
      at = end;
      let split = NaN;
      let reach = -Infinity;
      let widest = CELL_THRESHOLD;
      for (const item of band.flatMap(solid).sort((a, b) => a.x - b.x)) {
        if (reach > -Infinity && item.x - reach > widest)
          [widest, split] = [item.x - reach, (item.x + reach) / 2];
        reach = Math.max(reach, item.right);
      }
      const onLeft = (item: Placed) => item.x + item.right < 2 * split;
      // A band whose every line has text on both sides is a table's row of cells, or lines with
      // a tab stop: read line by line.
      if (
        Number.isNaN(split) ||
        band.every((row) => solid(row).some(onLeft) && solid(row).some((item) => !onLeft(item)))
      )
        for (const row of band) lines.push(row);
      else
        for (const keep of [onLeft, (item: Placed) => !onLeft(item)])
          for (const row of band) if (solid(row).some(keep)) lines.push(row.filter(keep));
    }
  }

  // The right edge of the page's text. A line flush with it, on a page where several are, may be
  // justified: its word spaces are stretched.
  const edge = runs.reduce((most, run) => Math.max(most, run.right), -Infinity);
  const flush = (line: Placed[]) => line.some((item) => !item.blank && item.right >= edge - 1);
  const justifiable = lines.filter(flush).length >= 3;
  // Marks by the 8pt band of the page their middle is in, so a line meets only those near it.
  const bands = new Map<number, Box[]>();
  for (const mark of marks) {
    const band = Math.floor((mark[1] + mark[3]) / 16);
    if (bands.has(band)) bands.get(band)!.push(mark);
    else bands.set(band, [mark]);
  }
  const near = (y: number, size: number) => {
    const found: Box[] = [];
    if (!Number.isFinite(y - size)) return found;
    for (let band = Math.floor((y - size) / 8); band <= Math.floor(y / 8); band += 1)
      for (const mark of bands.get(band) ?? []) found.push(mark);
    return found;
  };
  const text = lines
    .map((line) => {
      line.sort((a, b) => a.x - b.x);
      const justified = justifiable && flush(line);
      const kept: Placed[] = [];
      for (const item of line) {
        const previous = kept.at(-1);
        if (
          previous?.str !== item.str ||
          Math.abs(previous.x - item.x) >= 2 ||
          Math.abs(previous.y - item.y) >= 2
        )
          kept.push(item);
      }
      // A line drawn a glyph at a time — letter-spaced, "L U C A S   M O R E A U" — has its word
      // breaks where a gap is well past the line's usual one; pdf.js reported both as one space.
      const solid = kept.filter((item) => !item.blank);
      const gaps = solid
        .slice(1)
        .map((item, at) => item.x - solid[at].right)
        .sort((a, b) => a - b);
      const glyphs = solid.length > 3 && solid.every((item) => item.str.trim().length === 1);
      const wordGap = glyphs ? 1.5 * Math.max(gaps[gaps.length >> 1], 0.1) : Infinity;
      let out = "";
      let last: Placed | undefined;
      let space = false;
      for (const item of kept) {
        if (item.blank) {
          space = true;
          continue;
        }
        if (last) {
          const gap = item.x - last.right;
          const size = Math.max(item.size, last.size) || 10;
          // A space pdf.js saw is a word space up to an em wide (two on a justified line); past
          // that it is the gap between skill tags or table cells. Between two letter-spaced
          // words pdf.js kept apart, it is the gap between words.
          const cell = justified
            ? Math.max(CELL_THRESHOLD, 2 * size)
            : space
              ? size
              : Math.max(CELL_THRESHOLD, CELL_EMS * size);
          out +=
            gap > cell || gap > wordGap || (LETTERED.test(last.str) && LETTERED.test(item.str))
              ? "\t"
              : space || gap > 0.2 * size
                ? " "
                : "";
        }
        out += item.str;
        last = item;
        space = false;
      }
      const first = line.find((item) => !item.blank);
      const marked =
        first &&
        !MARKED.test(first.str) &&
        near(first.y, Math.min(first.size, 100)).some(([x0, y0, x1, y1]) => {
          const side = Math.max(x1 - x0, y1 - y0);
          const middle = (y0 + y1) / 2;
          return (
            side <= 0.45 * first.size &&
            side >= 0.1 * first.size &&
            Math.min(x1 - x0, y1 - y0) >= 0.6 * side &&
            x1 <= first.x + 0.5 &&
            first.x - x1 <= 1.5 * first.size &&
            middle <= first.y &&
            middle >= first.y - first.size
          );
        });
      return marked ? `• ${out}` : out;
    })
    .join("\n");

  return { text, columns: gutter?.ratio ?? null };
}

/** At most this many link targets are added to a document's text. */
const MAX_LINKS = 50;

/**
 * `text` with the web and email targets of its links that it does not already show, one per
 * line at the end. A resume whose links read "LinkedIn" and "GitHub" carries its profile URLs
 * only in the link; an ATS that reads the targets sees them, and so does the parser here.
 */
export function withLinks(text: string, targets: readonly string[]): string {
  const shown = text.toLowerCase();
  const missing = new Set<string>();
  for (const target of targets) {
    if (missing.size >= MAX_LINKS || target.length > 500) continue;
    const bare = target.trim().replace(/^mailto:([^?]*).*$/i, "$1");
    if (!/^(?:https?:\/\/\S+|[^\s@/:]+@[^\s@/]+)$/i.test(bare)) continue;
    // Scheme, "www." and trailing slashes aside, a target the text shows is not added again.
    let core = bare.replace(/^https?:\/\/(?:www\.)?/i, "").toLowerCase();
    while (/[/?#]$/.test(core)) core = core.slice(0, -1);
    if (!shown.includes(core)) missing.add(bare);
  }
  return missing.size ? `${text}\n${[...missing].join("\n")}` : text;
}
