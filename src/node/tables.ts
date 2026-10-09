/**
 * Ruled tables from a page's own vector drawing. Pure geometry, kept apart from the PDF reader so
 * it can be tested without one; `hidden.ts` collects the rules during the replay it already does.
 *
 * A browser prints a CSS border as a thin filled rectangle (`re f`), not a stroked line, so a
 * resume laid out in a bordered HTML table has no stroked rules at all. A rule here is either:
 * a stroked straight line, or a filled shape, no thicker than `RULE_WIDTH`. A table is rules that
 * close at least two rows of at least two cells each; only a cell with text in it counts.
 */

import type { Box } from "./surroundings.js";

export type { Box };
type Point = [number, number];

/** Points. Thicker than this, a filled shape is a bar, a band or a block, not a rule. */
const RULE_WIDTH = 1.5;
/** Points. Shorter than this, a thin shape is a dot or a corner, not a rule. */
const MIN_RULE_LENGTH = 3;
/** Points within which two pieces of rule are one line, and a line reaches a cell's corner. */
const SNAP = 2;
/** Points between two cells' borders that still make them neighbours: CSS `border-spacing`. */
const CELL_GAP = 4;
/** Rules kept from a page, and cells with text grouped into tables; past these, the rest are
 * not. A resume's tables draw a few hundred edges, but a dotted background or an underline per
 * word can draw thousands of thin shapes before them: joining and lookup cost n log n, and the
 * lookups are bounded by `MAX_CHECKS` besides. */
const MAX_RULES = 50_000;
const MAX_CELLS = 500;
/** Lines looked at, across a page, while finding the cell around each piece of text. */
const MAX_CHECKS = 1_000_000;

/**
 * Adds to `rules` what a path paints that is a rule: each thin subpath it fills; the four sides
 * of a thin frame it fills (a rectangle with a slightly smaller one cut out of it); and each
 * straight, level or upright segment it strokes, when `width` (the pen, in page points; absent
 * when the path is not stroked) is thin. `data` is pdf.js's path: `0 x y` move, `1 x y` line,
 * `2 x1 y1 x2 y2 x y` curve, `3` close. `toPage` takes a point to page space.
 */
export function pathRules(
  data: ArrayLike<number>,
  toPage: (x: number, y: number) => Point,
  fill: boolean,
  width: number | undefined,
  rules: Box[],
) {
  if (rules.length >= MAX_RULES) return;
  const keep = (box: Box) => {
    const [w, h] = [box[2] - box[0], box[3] - box[1]];
    if (
      rules.length < MAX_RULES &&
      Math.min(w, h) <= RULE_WIDTH &&
      Math.max(w, h) >= MIN_RULE_LENGTH
    )
      rules.push(box);
  };
  const boxes: Box[] = [];
  let start: Point | undefined;
  let last: Point | undefined;
  let box: Box | undefined;
  const reach = ([x, y]: Point) =>
    (box = box
      ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]
      : [x, y, x, y]);
  const line = (to: Point) => {
    if (last && width !== undefined && width <= RULE_WIDTH) {
      const [[x0, y0], [x1, y1]] = [last, to];
      if (Math.abs(y1 - y0) < 0.1)
        keep([Math.min(x0, x1), y0 - width / 2, Math.max(x0, x1), y0 + width / 2]);
      else if (Math.abs(x1 - x0) < 0.1)
        keep([x0 - width / 2, Math.min(y0, y1), x0 + width / 2, Math.max(y0, y1)]);
    }
    reach((last = to));
  };
  const point = (at: number) => toPage(Number(data[at]), Number(data[at + 1]));

  for (let at = 0; at < data.length;) {
    const code = data[at];
    if (code === 0) {
      if (box) boxes.push(box);
      box = undefined;
      reach((start = last = point(at + 1)));
      at += 3;
    } else if (code === 1) {
      line(point(at + 1));
      at += 3;
    } else if (code === 2) {
      // A curve is no rule, but its control points bound the shape it fills.
      reach(point(at + 1));
      reach(point(at + 3));
      reach((last = point(at + 5)));
      at += 7;
    } else if (code === 3) {
      if (start) line(start);
      at += 1;
    } else break;
  }
  if (box) boxes.push(box);
  if (!fill) return;
  for (let index = 0; index < boxes.length; index += 1) {
    const [outer, inner] = [boxes[index]!, boxes[index + 1]];
    const margins = inner && [
      inner[0] - outer[0],
      inner[1] - outer[1],
      outer[2] - inner[2],
      outer[3] - inner[3],
    ];
    if (inner && margins!.every((margin) => margin >= 0 && margin <= RULE_WIDTH)) {
      const [x0, y0, x1, y1] = outer;
      keep([x0, y0, x1, inner[1]]);
      keep([x0, inner[3], x1, y1]);
      keep([x0, y0, inner[0], y1]);
      keep([inner[2], y0, x1, y1]);
      index += 1;
    } else keep(outer);
  }
}

/** A straight line, level or upright: where it is across, and from where to where it runs. */
type Line = { at: number; from: number; to: number };

/** Pieces of one line that meet are one line: a collapsed border is drawn an edge per cell. */
function joinLines(pieces: Line[]) {
  pieces.sort((a, b) => Math.round(a.at) - Math.round(b.at) || a.from - b.from);
  const lines: Line[] = [];
  for (const piece of pieces) {
    const last = lines[lines.length - 1];
    if (last && Math.round(last.at) === Math.round(piece.at) && piece.from <= last.to + SNAP)
      last.to = Math.max(last.to, piece.to);
    else lines.push({ ...piece });
  }
  return lines.sort((a, b) => a.at - b.at);
}

/**
 * The index of the line nearest `at` on one side (`step` -1 below, 1 above) that runs from
 * `from` to `to`, or -1. Each line looked at spends one of `budget.left`.
 */
function nearest(
  lines: Line[],
  at: number,
  [from, to]: [number, number],
  step: 1 | -1,
  budget: { left: number },
) {
  let [low, high] = [0, lines.length];
  while (low < high) {
    const middle = (low + high) >> 1;
    if (lines[middle]!.at < at) low = middle + 1;
    else high = middle;
  }
  for (let index = step < 0 ? low - 1 : low; index >= 0 && index < lines.length; index += step) {
    if ((budget.left -= 1) < 0) return -1;
    const line = lines[index]!;
    if (line.from - SNAP <= from && to <= line.to + SNAP) return index;
  }
  return -1;
}

type Cell = { left: number; right: number; bottom: number; top: number };

/** Whether two ranges overlap by more than a touch. */
const overlap = (a0: number, a1: number, b0: number, b1: number) =>
  Math.min(a1, b1) - Math.max(a0, b0) > SNAP;

/** Two cells side by side or one above the other, sharing a border or a `border-spacing` gap. */
const neighbours = (a: Cell, b: Cell) =>
  (overlap(a.bottom, a.top, b.bottom, b.top) &&
    (Math.abs(a.right - b.left) <= CELL_GAP || Math.abs(b.right - a.left) <= CELL_GAP)) ||
  (overlap(a.left, a.right, b.left, b.right) &&
    (Math.abs(a.top - b.bottom) <= CELL_GAP || Math.abs(b.top - a.bottom) <= CELL_GAP));

/**
 * How many ruled tables a page holds: groups of neighbouring cells, each closed on four sides by
 * `rules` and holding one of `points` (where text is), with at least two rows of at least two
 * cells. So one rule under a heading, an underline, a border round the page or round one box,
 * and a page split by a rule into a header and two columns are not tables; a two-by-two grid is.
 *
 * Linear apart from sorting: each point finds its four sides by binary search, and the lines
 * looked at past that are bounded by `MAX_CHECKS` across the page.
 */
export function countRuledTables(rules: readonly Box[], points: readonly Point[]): number {
  const level: Line[] = [];
  const upright: Line[] = [];
  for (const [x0, y0, x1, y1] of rules)
    if (x1 - x0 >= y1 - y0) level.push({ at: (y0 + y1) / 2, from: x0, to: x1 });
    else upright.push({ at: (x0 + x1) / 2, from: y0, to: y1 });
  const [across, down] = [joinLines(level), joinLines(upright)];
  // Two rows of two cells need three lines each way.
  if (across.length < 3 || down.length < 3) return 0;

  const budget = { left: MAX_CHECKS };
  const cells = new Map<string, Cell>();
  for (const [x, y] of points) {
    if (cells.size >= MAX_CELLS || budget.left <= 0) break;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    // The sides either way along the line of text, then the rules above and below it that run
    // the whole way between them: a stray hairline across the cell is no side unless it does.
    const leftAt = nearest(down, x, [y, y], -1, budget);
    const rightAt = nearest(down, x, [y, y], 1, budget);
    if (leftAt < 0 || rightAt < 0) continue;
    const span: [number, number] = [down[leftAt]!.at, down[rightAt]!.at];
    const sides = [
      leftAt,
      rightAt,
      nearest(across, y, span, -1, budget),
      nearest(across, y, span, 1, budget),
    ];
    if (sides.some((side) => side < 0)) continue;
    const [left, right, bottom, top] = [
      down[sides[0]!]!,
      down[sides[1]!]!,
      across[sides[2]!]!,
      across[sides[3]!]!,
    ];
    // Closed: each side runs the length of the cell, corner to corner.
    const closed =
      [left, right].every((side) => side.from <= bottom.at + SNAP && side.to >= top.at - SNAP) &&
      [bottom, top].every((side) => side.from <= left.at + SNAP && side.to >= right.at - SNAP);
    if (closed)
      cells.set(sides.join(" "), {
        left: left.at,
        right: right.at,
        bottom: bottom.at,
        top: top.at,
      });
  }

  const list = [...cells.values()];
  const parent = list.map((_, index) => index);
  const root = (index: number): number => {
    while (parent[index] !== index) index = parent[index] = parent[parent[index]!]!;
    return index;
  };
  for (let a = 0; a < list.length; a += 1)
    for (let b = a + 1; b < list.length; b += 1)
      if (neighbours(list[a]!, list[b]!)) parent[root(a)] = root(b);

  // Per group of cells, the cells in each row; a table has two rows of two or more.
  const rows = new Map<number, Map<string, number>>();
  list.forEach((cell, index) => {
    const group = rows.get(root(index)) ?? new Map<string, number>();
    const row = `${Math.round(cell.bottom)} ${Math.round(cell.top)}`;
    rows.set(root(index), group.set(row, (group.get(row) ?? 0) + 1));
  });
  let tables = 0;
  for (const group of rows.values())
    if ([...group.values()].filter((count) => count >= 2).length >= 2) tables += 1;
  return tables;
}
