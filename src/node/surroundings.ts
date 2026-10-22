/** A rectangle in page points: x0, y0, x1, y1. */
export type Box = [number, number, number, number];

/**
 * Something drawn on the page before or after a text run. `fill` is "#rrggbb" or "" (unknown). A
 * "hole" is where a filled path (a frame) leaves a gap inside its bounding box: it paints nothing,
 * and `fill` and `alpha` are the path's.
 */
export type Drawn = {
  box: Box;
  order: number;
  kind: "image" | "shape" | "shading" | "hole";
  fill: string;
  alpha: number;
};

/** At or above this opacity, something drawn over text hides it. */
export const OPAQUE = 0.9;

const contains = ([x0, y0, x1, y1]: Box, [x, y]: [number, number]) =>
  x >= x0 && x <= x1 && y >= y0 && y <= y1;

/** What lies under and over a point when a run was drawn there. */
export type Surroundings = {
  /** The last thing drawn before the run that contains the point. */
  top: Drawn | undefined;
  /** Whether an image was drawn there before the run. */
  overImage: boolean;
  /** Whether something opaque was drawn over it afterwards. */
  covered: boolean;
  /** The last hole before the run that contains the point, if any. */
  hole?: Drawn;
  /** A hole that contains the point in an opaque path drawn after the run, if any. */
  holeOver?: Drawn;
};

const GRID = 8;

/**
 * Exact point checks one page may cost, across all its runs. The grid keeps an ordinary page far
 * below this, but shapes and runs packed into one cell still meet pairwise. Past the budget the
 * page is not measured, which the caller reports as such rather than as clean.
 */
export const MAX_POINT_CHECKS = 40_000_000;

type Cell = {
  /** Drawn things covering the whole cell, in drawing order: they contain every point in it. */
  full: Drawn[];
  /** The rest that overlap it, checked point by point. */
  partial: Drawn[];
  /** Holes that overlap it, checked point by point. */
  holes: Drawn[];
  firstFullImage: number;
  lastOpaqueFull: number;
};

/**
 * The surroundings of any point, from a coarse grid over the page, so a run meets only the shapes
 * near it. Each cell keeps the shapes that cover it whole (answered by order alone) apart from
 * those that only overlap it (checked exactly). The grid spans every run's centre as well as the
 * page, so a point is never clamped into a cell it is not in. `budget` is the exact point checks
 * allowed before it throws.
 */
export function indexDrawn(
  drawn: readonly Drawn[],
  points: ReadonlyArray<[number, number]>,
  pageBox: Box,
  budget = MAX_POINT_CHECKS,
): (point: [number, number], order: number) => Surroundings {
  let [ax0, ay0, ax1, ay1] = pageBox;
  for (const [x, y] of points)
    if (Number.isFinite(x) && Number.isFinite(y)) {
      [ax0, ay0] = [Math.min(ax0, x), Math.min(ay0, y)];
      [ax1, ay1] = [Math.max(ax1, x), Math.max(ay1, y)];
    }
  const width = Math.max(ax1 - ax0, 1) / GRID;
  const height = Math.max(ay1 - ay0, 1) / GRID;
  const column = (x: number) => Math.min(GRID - 1, Math.max(0, Math.floor((x - ax0) / width)));
  const row = (y: number) => Math.min(GRID - 1, Math.max(0, Math.floor((y - ay0) / height)));

  const cells: Cell[] = Array.from({ length: GRID * GRID }, () => ({
    full: [],
    partial: [],
    holes: [],
    firstFullImage: Infinity,
    lastOpaqueFull: -Infinity,
  }));
  // Slack, so a box edge on a cell edge is not taken to contain a point it misses by rounding.
  const slack = 1e-6 * Math.max(width, height);
  let checks = 0;
  for (const item of drawn) {
    const [x0, y0, x1, y1] = item.box;
    // A box with a NaN corner contains nothing.
    if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
    for (let r = row(y0); r <= row(y1); r += 1)
      for (let c = column(x0); c <= column(x1); c += 1) {
        const cell = cells[r * GRID + c];
        if (item.kind === "hole") {
          cell.holes.push(item);
          continue;
        }
        const [cx0, cy0] = [ax0 + c * width, ay0 + r * height];
        const whole =
          x0 <= cx0 - slack &&
          y0 <= cy0 - slack &&
          x1 >= cx0 + width + slack &&
          y1 >= cy0 + height + slack;
        if (!whole) {
          cell.partial.push(item);
          continue;
        }
        cell.full.push(item);
        if (item.kind === "image") cell.firstFullImage = Math.min(cell.firstFullImage, item.order);
        if (item.alpha >= OPAQUE) cell.lastOpaqueFull = Math.max(cell.lastOpaqueFull, item.order);
      }
  }

  return (point, order) => {
    const [x, y] = point;
    if (!Number.isFinite(x) || !Number.isFinite(y))
      return { top: undefined, overImage: false, covered: false };
    const cell = cells[row(y) * GRID + column(x)];

    // The last whole-cell shape drawn before the run: `full` is in drawing order.
    let low = 0;
    let high = cell.full.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (cell.full[middle].order < order) low = middle + 1;
      else high = middle;
    }
    let top = low > 0 ? cell.full[low - 1] : undefined;
    let overImage = cell.firstFullImage < order;
    let covered = cell.lastOpaqueFull > order;

    checks += cell.partial.length + cell.holes.length;
    if (checks > budget) throw new Error("Too much drawn in one place to measure.");
    for (const item of cell.partial) {
      if (!contains(item.box, point)) continue;
      if (item.order < order) {
        if (!top || item.order > top.order) top = item;
        if (item.kind === "image") overImage = true;
      } else if (item.order > order && item.alpha >= OPAQUE) covered = true;
    }
    let hole: Drawn | undefined;
    let holeOver: Drawn | undefined;
    for (const item of cell.holes) {
      if (!contains(item.box, point)) continue;
      if (item.order < order) {
        if (!hole || item.order > hole.order) hole = item;
      } else if (item.order > order && item.alpha >= OPAQUE) holeOver = item;
    }
    return { top, overImage, covered, hole, holeOver };
  };
}
