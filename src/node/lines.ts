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
 * in two fonts) join, unless pdf.js ended a line between them. A run drawn twice in place — the
 * transparent copy Chrome lays over text with a shadow or an outline — is read once.
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
/** Right-hand text this short, in characters, may be a tab stop of the text left of it. */
const TAB_STOP_CHARS = 40;

type Placed = {
  str: string;
  x: number;
  y: number;
  right: number;
  size: number;
  blank: boolean;
  /** pdf.js ended a line after it. */
  eol: boolean;
};

/** A list marker drawn as a shape — a filled disc or square — rather than as a glyph. */
const MARKED = /^\s*[•●▪■◦○‣∙·*–-]/u;
/** A word set with a space between its letters, as a letter-spaced heading extracts. */
const LETTERED = /^\s*\S(?: \S)+\s*$/u;

/** The gaps between a line's runs that are wider than abutting, smallest first. */
function gapsOf(line: readonly Placed[]) {
  const solid = line.filter((item) => !item.blank);
  return solid
    .slice(1)
    .map((item, at) => item.x - solid[at]!.right)
    .filter((gap, at) => gap > 0.2 * (solid[at + 1]!.size || 10))
    .sort((a, b) => a - b);
}

/** Whether no gap of a line stands out from the rest, as a stretched word space does not. */
const even = (gaps: readonly number[]) =>
  gaps.length >= 2 && gaps[gaps.length - 1]! <= 1.5 * gaps[(gaps.length - 1) >> 1]!;

/**
 * `pageWidth` lets the page's gutter be found (and is what `columns` measures); `marks` are small
 * filled shapes drawn on the page, in the same viewport space, for the list markers Chrome draws
 * as paths: lines of body text with one just before their first glyph, two or more in a list,
 * start with "• ".
 */
export function pageText(
  items: readonly PdfTextItem[],
  toViewport: (x: number, y: number) => number[],
  pageWidth = 0,
  marks: readonly Box[] = [],
): { text: string; columns: number | null } & PageLines {
  let placed: Placed[] = [];
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
      eol: item.hasEOL,
    });
  }
  placed.sort((a, b) => a.y - b.y || a.x - b.x);

  // A run drawn twice within a point or two — a shadow, or the transparent copy over an outline
  // — is read once, before lines are formed: the copies' baselines may straddle two lines'.
  const seen = new Set<string>();
  const key = (item: Placed, dx: number, dy: number) =>
    `${Math.round(item.x / 2) + dx}|${Math.round(item.y / 2) + dy}|${item.str}`;
  placed = placed.filter((item) => {
    if (item.blank) return true;
    for (const dx of [-1, 0, 1])
      for (const dy of [-1, 0, 1]) if (seen.has(key(item, dx, dy))) return false;
    seen.add(key(item, 0, 0));
    return true;
  });

  // A line's baseline is its middle item's, not its first's, so one a hair above the rest does
  // not split it; never further than one and a half lines' threshold from its top.
  const rows: Placed[][] = [];
  for (const item of placed) {
    const row = rows.at(-1);
    if (
      row &&
      item.y - row[row.length >> 1]!.y < LINE_THRESHOLD &&
      item.y - row[0]!.y < 1.5 * LINE_THRESHOLD
    )
      row.push(item);
    else rows.push([item]);
  }

  const runs: PositionedRun[] = [];
  rows.forEach((row) => {
    for (const { x, y, right, str, size, blank } of row)
      if (!blank)
        runs.push({
          left: x,
          right,
          mass: str.trim().length,
          row,
          size,
          stop: /[\d,]/.test(str),
          y,
        });
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
      // A line across the gutter — a heading, a rule of text — or one whose short right-hand
      // text is a tab stop of its left-hand text ends the band above it and is read whole.
      if (
        l.length + r.length < solid.length ||
        (tabs &&
          l.length &&
          r.length &&
          r.reduce((sum, item) => sum + item.str.trim().length, 0) <= TAB_STOP_CHARS &&
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

  for (const line of lines) line.sort((a, b) => a.x - b.x);
  // The right edge of the page's text. A line flush with it may be justified — its word spaces
  // stretched — when the page has several such lines whose gaps are all alike, it starts where
  // they start, and no gap of its own stands out: a date set apart from its title does.
  const edge = runs.reduce((most, run) => Math.max(most, run.right), -Infinity);
  const flush = (line: Placed[]) => line.some((item) => !item.blank && item.right >= edge - 1);
  const start = (line: Placed[]) => line.find((item) => !item.blank)?.x ?? Infinity;
  const stretched = lines.filter((line) => flush(line) && even(gapsOf(line)));
  const margin =
    stretched.length >= 3
      ? stretched.reduce((least, line) => Math.min(least, start(line)), Infinity)
      : NaN;

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
  // The body text's size: the one most characters on the page are set in.
  const sizes = new Map<number, number>();
  for (const { size = 0, mass } of runs) sizes.set(size, (sizes.get(size) ?? 0) + mass);
  let body = 0;
  for (const [size, mass] of sizes) if (mass > (sizes.get(body) ?? 0)) body = size;

  const texts = lines.map((line) => {
    const justified = Math.abs(start(line) - margin) <= 1 && flush(line) && even(gapsOf(line));
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
            : space || last.eol || gap > 0.2 * size
              ? " "
              : "";
      }
      out += item.str;
      last = item;
      space = false;
    }
    // A small filled shape just before the line's first glyph: its list marker, if the line
    // reads as a list item does — body text, not a short line in capitals or a larger size, as
    // a heading's square or a timeline's dot beside a job title are.
    const first = solid[0];
    const shape =
      first && !MARKED.test(first.str)
        ? near(first.y, Math.min(first.size, 100)).find(([x0, y0, x1, y1]) => {
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
          })
        : undefined;
    const heading =
      !first ||
      first.size > 1.05 * body ||
      (/\p{Lu}/u.test(out) && !/\p{Ll}/u.test(out) && out.trim().split(/\s+/).length <= 4);
    return { out, shape: !!shape, mark: heading ? undefined : shape?.[0], x: first?.x ?? NaN };
  });

  // A mark is a list marker where it starts two or more items of one list: lines marked at the
  // same place, with nothing between them but the wrapped lines of their items. A list of one
  // item is one whose mark sits where a longer list's marks do, or where another sentence's
  // does: a job title beside a timeline's dot is a few words.
  const bulleted = new Set<number>();
  const lists = new Map<number, number>();
  const add = (mark: number, count: number) =>
    lists.set(Math.round(mark), (lists.get(Math.round(mark)) ?? 0) + count);
  for (let at = 0; at < texts.length;) {
    const { mark, x, out } = texts[at]!;
    let end = at + 1;
    const items = [at];
    if (mark !== undefined)
      for (; end < texts.length; end += 1) {
        const next = texts[end]!;
        if (next.mark !== undefined && Math.abs(next.mark - mark) <= 1) items.push(end);
        else if (next.shape || Math.abs(next.x - x) > 2) break;
      }
    if (items.length >= 2) {
      for (const item of items) bulleted.add(item);
      add(mark!, 2);
    } else if (mark !== undefined && out.trim().split(/\s+/).length >= 6) add(mark, 1);
    at = end;
  }
  // Where a mark stands beside a short line — a title on a timeline's rail, a label — a mark at
  // that place is decoration, however long the line beside it.
  const decorative = new Set<number>();
  for (const { mark, out } of texts)
    if (mark !== undefined && out.trim().split(/\s+/).length < 6)
      for (const dx of [-1, 0, 1]) decorative.add(Math.round(mark) + dx);
  texts.forEach(({ mark, out }, at) => {
    if (mark === undefined || out.trim().split(/\s+/).length < 6) return;
    const listed = (dx: number) => (lists.get(Math.round(mark) + dx) ?? 0) >= 2;
    // A list of one: the only item of a role with one bullet, a sentence with nothing on the
    // page to say its mark is a timeline's.
    if ([-1, 0, 1].some(listed) || !decorative.has(Math.round(mark))) bulleted.add(at);
  });
  const read = texts.map(({ out }, at) => (bulleted.has(at) ? `• ${out}` : out));

  return {
    text: read.join("\n"),
    columns: gutter?.ratio ?? null,
    lines: read,
    ys: lines.map((line) => line[0]?.y ?? 0),
  };
}

/** A page's lines and the height of each, from `pageText`. */
type PageLines = { lines: string[]; ys: number[] };

/**
 * The pages' text, without what a PDF prints on every page. A line among the top or bottom two
 * of a page, printed at the same height (within 2pt) on another page, runs on every page: with
 * the same text it is a header or footer, read once, before the text or after it as a DOCX's
 * are; with only its numbers changed ("Page 1 of 2") it is a page number, and is not read. A
 * later page that opens with the line the first page opens with ("Jordan Ellery - Resume" over
 * the name) opens with its header, which is not read either. Left in, each fell between the last
 * line of one page and the first of the next, and a role the page break parted took it for its
 * title and employer.
 */
export function joinPages(pages: readonly PageLines[]): string {
  const kept = pages.map(({ lines }) => [...lines]);
  const margins = [new Set<string>(), new Set<string>()];
  // [page, line, height, 0 at the top or 1 at the bottom], by the line's text with its numbers
  // masked.
  const groups = new Map<string, number[][]>();
  const tops = pages.map(({ lines, ys }, page) => {
    const order = ys.map((_, at) => at).sort((a, b) => ys[a]! - ys[b]!);
    order.forEach((at, rank) => {
      const key = lines[at]!.trim().replace(/\d+/g, "#");
      if (key && (rank < 2 || rank >= order.length - 2))
        (groups.get(key) ?? groups.set(key, []).get(key)!).push([page, at, ys[at]!, +(rank > 1)]);
    });
    return order[0]!;
  });
  for (const group of groups.values()) {
    // By height, each line is matched with the next on another page within 2pt.
    group.sort((a, b) => a[2]! - b[2]!);
    const running = new Set<number[]>();
    group.forEach((line, at) => {
      for (let next = at + 1; next < group.length && group[next]![2]! - line[2]! <= 2; next += 1)
        if (group[next]![0] !== line[0]) {
          running.add(line).add(group[next]!);
          break;
        }
    });
    const texts = new Set([...running].map(([page, at]) => pages[page!]!.lines[at!]!));
    for (const [page, at, , side] of running) {
      if (texts.size === 1) margins[side!]!.add(kept[page!]![at!]!);
      kept[page!]![at!] = "\0";
    }
  }
  // The line a page opens with.
  const opening = (page: number) => pages[page]?.lines[tops[page]!]?.trim() ?? "";
  if (opening(0).includes(" "))
    for (let page = 1; page < pages.length; page += 1)
      if (opening(page).includes(opening(0))) kept[page]![tops[page]!] = "\0";
  return [margins[0]!, ...kept, margins[1]!]
    .map((lines) => [...lines].filter((line) => line !== "\0").join("\n"))
    .map((part) => part && `${part}\n\n`)
    .join("");
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
  const missing = new Map<string, string>();
  for (const target of targets) {
    if (missing.size >= MAX_LINKS || target.length > 500) continue;
    const bare = target.trim().replace(/^mailto:([^?]*).*$/i, "$1");
    if (!/^(?:https?:\/\/\S+|[^\s@/:]+@[^\s@/]+)$/i.test(bare)) continue;
    // Scheme, "www." and trailing slashes aside, a target the text shows is not added again,
    // nor one added already in another form.
    let core = bare.replace(/^https?:\/\/(?:www\.)?/i, "").toLowerCase();
    while (/[/?#]$/.test(core)) core = core.slice(0, -1);
    if (!shown.includes(core) && !missing.has(core)) missing.set(core, bare);
  }
  return missing.size ? `${text}\n${[...missing.values()].join("\n")}` : text;
}
