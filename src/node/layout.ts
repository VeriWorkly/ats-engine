/** Column detection from positioned text runs: pure arithmetic, apart from the PDF reader. */

/**
 * A run of text on a page, by horizontal extent and character count. `row` groups the runs of one
 * line (compared by identity) and `size` is their font size: together they tell a date pinned to
 * the right margin from a second column.
 */
export type PositionedRun = {
  left: number;
  right: number;
  mass: number;
  row?: unknown;
  size?: number;
  /** Whether its text could be a tab stop's (a date or place has a digit or comma). Unknown is taken as could. */
  stop?: boolean;
  /** Its baseline, top of the page first. Given, a side wholly above or below the other is not a column beside it. */
  y?: number;
};

/** The best gutter: the share of text beyond it, its position, and whether right-aligned runs were read as tab stops. */
export type Gutter = { ratio: number; split: number; tabs: boolean };

/** Below this many runs a page carries no layout signal. Low on purpose: a sparse page needs real text on both sides to report a gutter. */
const MIN_ITEMS_FOR_COLUMN_SIGNAL = 12;

/** Candidate gutters are searched across the middle of the page, in 4pt steps. */
const GUTTER_SEARCH_START = 0.3;
const GUTTER_SEARCH_END = 0.7;
const GUTTER_STEP = 4;
/** Points from the page's right text edge within which a run is right-aligned to it. */
const FLUSH = 3;
/** Characters of right-hand text a tab stop holds at most: a date, a place, not a paragraph. */
export const TAB_STOP_CHARS = 40;

/**
 * Whether the text left and right of `split` sits side by side: at least half the thinner side's
 * characters lie between the other side's first and last baselines. A centred heading over short
 * lines leaves an empty strip too, but above the block, not beside it. Without baselines the
 * sides are taken as beside.
 */
function besideEachOther(rows: Iterable<PositionedRun[]>, split: number): boolean {
  const sides = [
    { mass: 0, top: Infinity, bottom: -Infinity, runs: [] as PositionedRun[] },
    { mass: 0, top: Infinity, bottom: -Infinity, runs: [] as PositionedRun[] },
  ];
  for (const row of rows)
    for (const run of row) {
      if (run.y === undefined) return true;
      if (run.left < split && run.right > split) continue;
      const side = sides[run.right <= split ? 0 : 1]!;
      side.mass += run.mass;
      side.top = Math.min(side.top, run.y);
      side.bottom = Math.max(side.bottom, run.y);
      side.runs.push(run);
    }
  const [thin, thick] = sides[0]!.mass <= sides[1]!.mass ? sides : [sides[1]!, sides[0]!];
  if (!thin.mass) return true;
  // One side's runs between the other's first and last baselines, and their characters.
  const inside = (side: typeof thin, other: typeof thin) =>
    side.runs.filter((run) => run.y! >= other.top - 1 && run.y! <= other.bottom + 1);
  const mass = (runs: PositionedRun[]) => runs.reduce((sum, run) => sum + run.mass, 0);
  const beside = inside(thin, thick);
  // Or the thicker side lies within the thinner one's, with more than one run beside: a main
  // column beside a sidebar that runs on below it. Such a sidebar carries an eighth of the text or
  // more; a right-aligned contact block or page number carries less.
  return (
    mass(beside) >= thin.mass / 2 ||
    (mass(inside(thick, thin)) >= thick.mass / 2 &&
      beside.length > 1 &&
      7 * thin.mass >= thick.mass)
  );
}

/**
 * Finds the most balanced vertical channel that no text crosses, and reports the share of the
 * page's text on its thinner side: near 0.5 for balanced columns, 0.2 for a sidebar, 0.1 for
 * right-aligned dates, graded separately by the policy bands. Measured in characters, not runs.
 * Text right of the gutter on a line that also has same-size text left of it is a tab stop, not a
 * column, when those lines all end flush with the right margin ("City, ST · Jan 2021 – Present"
 * after each job title). A second column's lines are ragged, long, or on baselines of their own.
 * Returns `null` when the page has too little text to say.
 */
export function findGutter(runs: readonly PositionedRun[], pageWidth: number): Gutter | null {
  if (runs.length < MIN_ITEMS_FOR_COLUMN_SIGNAL || pageWidth <= 0) return null;

  // A rule, a full-width heading, or a page border may legitimately cross a real gutter.
  const straddleAllowance = Math.max(1, Math.round(runs.length * 0.02));
  const rows = new Map<unknown, PositionedRun[]>();
  let edge = -Infinity;
  for (const run of runs) {
    const key = run.row ?? run;
    const row = rows.get(key);
    if (row) row.push(run);
    else rows.set(key, [run]);
    edge = Math.max(edge, run.right);
  }
  const found: Array<Gutter & { straddling: number }> = [];

  for (
    let split = pageWidth * GUTTER_SEARCH_START;
    split <= pageWidth * GUTTER_SEARCH_END;
    split += GUTTER_STEP
  ) {
    let straddling = 0;
    let left = 0;
    let right = 0;
    // Lines with text on both sides in one size: how many end at the margin, how many hold a few
    // words on the right, their right text; and lines with text on the right alone.
    let shared = 0;
    let flush = 0;
    let short = 0;
    let sharedRight = 0;
    let rightOnly = 0;

    for (const row of rows.values()) {
      let [l, r, reach, lSize, rSize] = [0, 0, 0, 0, 0];
      let stop = false;
      for (const run of row) {
        if (run.left < split && run.right > split) straddling += 1;
        else if (run.right <= split) {
          l += run.mass;
          lSize = Math.max(lSize, run.size ?? 0);
        } else {
          r += run.mass;
          stop ||= run.stop !== false;
          reach = Math.max(reach, run.right);
          rSize = Math.max(rSize, run.size ?? 0);
        }
      }
      left += l;
      right += r;
      if (l && r && Math.abs(lSize - rSize) <= 0.2 * Math.max(lSize, rSize)) {
        shared += 1;
        sharedRight += r;
        if (reach >= edge - FLUSH) flush += 1;
        if (r <= TAB_STOP_CHARS && stop) short += 1;
      } else if (r && !l) rightOnly += 1;
    }

    if (!besideEachOther(rows.values(), split)) continue;

    // Tab stops: flush right, beside text on the left, a few characters with a digit or comma. A
    // right side of words, or with more lines of its own than it shares, is a column.
    const tabs = shared > 0 && flush >= 0.8 * shared && short >= 0.8 * shared && rightOnly < shared;
    if (tabs) right -= sharedRight;
    if (straddling > straddleAllowance || left + right === 0) continue;
    found.push({ ratio: Math.min(left, right) / (left + right), split, tabs, straddling });
  }

  // The share is the best found; the split is, among those close to it, the one fewest runs cross.
  const ratio = found.reduce((most, gutter) => Math.max(most, gutter.ratio), 0);
  let best: Gutter & { straddling: number } = {
    ratio,
    split: NaN,
    tabs: false,
    straddling: Infinity,
  };
  for (const gutter of found)
    if (gutter.ratio >= ratio - 0.05 && gutter.straddling < best.straddling) best = gutter;
  return { ratio, split: best.split, tabs: best.tabs };
}
