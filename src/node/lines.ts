/**
 * A PDF page's text from pdf.js's positioned items, one line per printed line, in reading order.
 *
 * pdf.js lists text in paint order, which is not reading order (Chrome paints a floated date
 * before its title), so items are placed by position: grouped into lines by baseline, each line
 * left to right, lines top to bottom, and on a page with a gutter (`findGutter`) each side in
 * turn, band by band between the lines that cross it.
 *
 * Within a line: a gap wider than a cell's is a tab (the column gap the parser splits a title from
 * its employer on); a narrower one, or a space pdf.js reported, is a space; abutting runs join,
 * unless pdf.js ended a line between them. A run drawn twice in place is read once.
 */

import { findGutter, TAB_STOP_CHARS, type PositionedRun } from "./layout.js";
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
/** A gap wider than this many points and font sizes is a cell gap: skill tags, table columns, a date set apart. */
const CELL_THRESHOLD = 7;
const CELL_EMS = 0.6;

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

/** A list marker glyph; a marker drawn as a shape is matched against `marks`. */
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
 * `pageWidth` lets the page's gutter be found (what `columns` measures); `marks` are small filled
 * shapes in viewport space, for list markers Chrome draws as paths: body-text lines with one just
 * before their first glyph, two or more in a list, start with "• ".
 */
export function pageText(
  items: readonly PdfTextItem[],
  toViewport: (x: number, y: number) => number[],
  pageWidth = 0,
  marks: readonly Box[] = [],
): { columns: number | null } & PageLines {
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

  // A run drawn twice within a point or two (a shadow, a transparent copy) is read once, before
  // lines form: the copies' baselines may straddle two lines.
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

  // A line's baseline is its middle item's, so one a hair above the rest does not split it; never
  // further than 1.5 thresholds from its top.
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
      // A line across the gutter, or one whose short right-hand text is a tab stop, ends the band
      // above it and is read whole.
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
    // No gutter, but a band of lines overlapping vertically (a large name beside a right-aligned
    // contact block) is two blocks side by side: each read whole, left first, when a channel no
    // text crosses parts them.
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
      // A band whose every line has text on both sides is a table row or tab stops: line by line.
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
  // The right edge of the page's text. A line flush with it is justified (word spaces stretched)
  // when several such lines have alike gaps, it starts where they start, and no gap of its own
  // stands out (a date set apart from its title does).
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
    // A line drawn a glyph at a time ("L U C A S   M O R E A U") breaks words where a gap is well
    // past the usual one; pdf.js reported both as one space.
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
        // A space pdf.js saw is a word space up to an em wide (two if justified); past that it is a
        // cell gap.
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
    // A small filled shape just before the first glyph is a list marker if the line is body text,
    // not a heading's square or a timeline's dot.
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
  // same place with only wrapped lines between them. A list of one counts where its mark sits
  // where a longer list's or another sentence's does.
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
  // A mark beside a short line (a timeline's title) is decoration there, however long the line.
  const decorative = new Set<number>();
  for (const { mark, out } of texts)
    if (mark !== undefined && out.trim().split(/\s+/).length < 6)
      for (const dx of [-1, 0, 1]) decorative.add(Math.round(mark) + dx);
  texts.forEach(({ mark, out }, at) => {
    if (mark === undefined || out.trim().split(/\s+/).length < 6) return;
    const listed = (dx: number) => (lists.get(Math.round(mark) + dx) ?? 0) >= 2;
    // A list of one: a role's only bullet, with nothing to say its mark is a timeline's.
    if ([-1, 0, 1].some(listed) || !decorative.has(Math.round(mark))) bulleted.add(at);
  });
  const read = texts.map(({ out }, at) => (bulleted.has(at) ? `• ${out}` : out));

  return {
    columns: gutter?.ratio ?? null,
    lines: read,
    ys: lines.map((line) => line[0]?.y ?? 0),
  };
}

/** A page's lines and the height of each, from `pageText`. */
type PageLines = { lines: string[]; ys: number[] };

/**
 * The pages' text, without what a PDF prints on every page. A page's margins are its first and
 * last line or two, when a gap wider than 1.5 usual line gaps parts them from the body. A margin
 * line at the same height (within 2pt) on another page runs on every page: with the same text it
 * is a header or footer, read once, before or after the text as a DOCX's are; with only its
 * numbers changed, each the number of its page ("Page 1 of 2"), it is a page number, not read. A
 * later page whose top margin, above where the first page's text starts, opens with the first
 * page's opening line opens with its header, not read either.
 */
export function joinPages(pages: readonly PageLines[]): string {
  type Line = [text: string, height: number];
  const rows = pages.map(({ lines, ys }) => lines.map((text, at): Line => [text, ys[at]!]));
  const sorted = rows.map((page) => [...page].sort((a, b) => a[1] - b[1]));
  // The usual line gap is a quartile, not the median: a short last page has few lines, far apart.
  const gaps = sorted
    .flatMap((page) => page.slice(1).map(([, y], at) => y - page[at]![1]))
    .filter((gap) => gap > 0.5)
    .sort((a, b) => a - b);
  const wide = 1.5 * gaps[gaps.length >> 2]!;
  // Lines in a margin, by their text with its numbers masked, with their page.
  const groups = new Map<string, Array<[number, Line]>>();
  // Each page's top and bottom margins.
  const edges = sorted.map((page, number) => {
    const gap = (at: number) => page[at + 1]![1] - page[at]![1] > wide;
    const count = page.length;
    const top = count > 1 && gap(0) ? 1 : count > 2 && gap(1) ? 2 : 0;
    const bottom =
      count > 1 && gap(count - 2) ? count - 1 : count > 2 && gap(count - 3) ? count - 2 : count;
    const margins = [page.slice(0, top), page.slice(Math.max(top, bottom))];
    for (const line of margins.flat()) {
      const key = line[0].trim().replace(/\d+/g, "#");
      (groups.get(key) ?? groups.set(key, []).get(key)!).push([number, line]);
    }
    return margins;
  });
  // The running lines: their text for a header or footer, "" for a page number.
  const running = new Map<Line, string>();
  for (const group of groups.values()) {
    // By height, each line is matched with the next on another page within 2pt.
    group.sort((a, b) => a[1][1] - b[1][1]);
    const found = new Set<[number, Line]>();
    group.forEach((line, at) => {
      for (
        let next = at + 1;
        next < group.length && group[next]![1][1] - line[1][1] <= 2;
        next += 1
      )
        if (group[next]![0] !== line[0]) {
          found.add(line).add(group[next]!);
          break;
        }
    });
    const same = new Set([...found].map(([, [text]]) => text)).size === 1;
    // Only its numbers changed, and each the number of its page: a page number.
    if (same || [...found].every(([page, [text]]) => text.match(/\d+/g)?.includes(`${page + 1}`)))
      for (const [, line] of found) running.set(line, same ? line[0] : "");
  }
  // A margin runs when all of it does: a heading and its line at a page foot are body text.
  const margins = [new Set<string>(), new Set<string>()];
  const dropped = new Set<Line>();
  for (const sides of edges)
    sides.forEach((lines, side) => {
      if (lines.every((line) => running.has(line)))
        for (const line of lines) {
          if (running.get(line)) margins[side]!.add(line[0]);
          dropped.add(line);
        }
    });
  const [opening, height] = sorted[0]?.[0] ?? ["", 0];
  if (opening.trim().includes(" "))
    for (const [[line]] of edges.slice(1))
      if (line && line[1] < height - 2 && line[0].trim().startsWith(opening.trim()))
        dropped.add(line);
  return [
    margins[0]!,
    ...rows.map((page) => page.filter((line) => !dropped.has(line)).map(([text]) => text)),
    margins[1]!,
  ]
    .map((lines) => [...lines].join("\n"))
    .map((part) => part && `${part}\n\n`)
    .join("");
}

/** At most this many link targets are added to a document's text. */
const MAX_LINKS = 50;
/** Characters searched for link targets in all: a thousand searches of a 50,000-character text. */
const MAX_SEARCHED_CHARS = 50_000_000;
/** A ".", "@" or "/" inside an address, not ending it: what a shown address's word holds. */
const ADDRESS_MARK = /[.@/]./;

/**
 * `text` with the web and email targets of its links that it does not already show, one per line
 * at the end: a link reading "LinkedIn" carries its URL only in the target.
 *
 * An address has no space, so the text shows it inside one word; one with a mark
 * (`ADDRESS_MARK`) is looked for among the words that have one, a few hundred characters in a
 * resume, not in the whole text. The searches stop after `MAX_SEARCHED_CHARS`.
 */
export function withLinks(text: string, targets: readonly string[]): string {
  const lowered = text.toLowerCase();
  const marked = lowered
    .split(/\s+/)
    .filter((word) => ADDRESS_MARK.test(word))
    .join("\n");
  const missing = new Map<string, string>();
  const checked = new Set<string>();
  let searched = 0;
  for (const target of targets) {
    if (missing.size >= MAX_LINKS) break;
    if (target.length > 500) continue;
    const bare = target.trim().replace(/^mailto:([^?]*).*$/i, "$1");
    if (!/^(?:https?:\/\/\S+|[^\s@/:]+@[^\s@/]+)$/i.test(bare)) continue;
    // Scheme, "www." and trailing slashes aside, a target already shown or added is skipped.
    let core = bare.replace(/^https?:\/\/(?:www\.)?/i, "").toLowerCase();
    while (/[/?#]$/.test(core)) core = core.slice(0, -1);
    if (checked.has(core)) continue;
    checked.add(core);
    const words = ADDRESS_MARK.test(core) ? marked : lowered;
    searched += words.length;
    if (searched > MAX_SEARCHED_CHARS) break;
    if (!words.includes(core)) missing.set(core, bare);
  }
  return missing.size ? `${text}\n${[...missing.values()].join("\n")}` : text;
}
