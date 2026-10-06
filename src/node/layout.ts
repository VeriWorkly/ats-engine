/**
 * Column detection from positioned text runs. Pure arithmetic, kept apart from the PDF reader so
 * it can be tested without one.
 */

/**
 * A run of text on a page, by horizontal extent and how many characters it carries. `row` groups
 * the runs printed on one line (any value, compared by identity) and `size` is their font size:
 * together they tell a date pinned to the right margin from a second column.
 */
export type PositionedRun = {
  left: number;
  right: number;
  mass: number;
  row?: unknown;
  size?: number;
  /** Whether its text could be a tab stop's — a date or a place has a digit or a comma — rather
   * than a word of a second column. Unknown is taken as could. */
  stop?: boolean;
};

/** The best gutter: the share of text beyond it, where it is, and whether right-aligned runs
 * on the left side's lines were read as tab stops rather than as column text. */
export type Gutter = { ratio: number; split: number; tabs: boolean };

/**
 * Below this many positioned text runs a page carries no usable layout signal. Set low on
 * purpose: a sparse page cannot produce a false column reading, because the balance term below
 * needs real text on both sides of the gutter before it reports anything.
 */
const MIN_ITEMS_FOR_COLUMN_SIGNAL = 12;

/** Candidate gutters are searched across the middle of the page, in 4pt steps. */
const GUTTER_SEARCH_START = 0.3;
const GUTTER_SEARCH_END = 0.7;
const GUTTER_STEP = 4;
/** Points from the page's right text edge within which a run is right-aligned to it. */
const FLUSH = 3;
/** Characters of right-hand text a tab stop holds at most: a date, a place, not a paragraph. */
const TAB_STOP_CHARS = 40;

/**
 * Finds the most balanced vertical channel that no text crosses, and reports how much of the
 * page's text sits on the thinner side of it.
 *
 * This measures the layout itself rather than a side effect of it. Inferring columns from the
 * extracted character stream can only ever see a two-column page whose columns happen to share
 * text lines; a PDF that emits its left column in full and then its right — equally unreadable
 * to a parser that maps fields by position — produces a perfectly linear stream.
 *
 * Reported as a share rather than a boolean because the shape matters: a balanced two-column
 * resume lands near 0.5, a narrow sidebar near 0.2, and right-aligned dates in an otherwise
 * single-column layout near 0.1. Those are three different amounts of trouble, and the policy
 * bands grade them separately.
 *
 * The share is measured in characters rather than in text runs: a column of four-digit years is
 * a tenth of the page's text. And text right of the gutter on a line that also has text left of
 * it, in the same size, is a tab stop rather than a column when those lines all end flush with
 * the right margin: "City, ST · Jan 2021 – Present" after every job title, with short bullets
 * under it, measured 0.26 — a sidebar's share — on a single-column resume. A second column's
 * lines are ragged, or long, or mostly on baselines of their own — a right-aligned sidebar ends
 * every line flush — so it still counts when some of its baselines happen to match the first's.
 *
 * `min(left, right)` covers the other end: a page whose lines are simply shorter than the
 * candidate split has no text at all on the far side, so the share is zero and no gutter is
 * reported. Returns `null` when the page has too little text to say.
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
    // Lines with text on both sides in one size; how many end at the margin, and how many hold a
    // few words on the right; their right text; lines with text on the right alone.
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

    // Tab stops: flush right, each beside text on its left, and a date or a place — a few
    // characters with a digit or a comma. A right side of words — a sidebar's skills, its email
    // — or with more lines of its own than lines it shares is a column whose baselines happen to
    // meet the other's.
    const tabs = shared > 0 && flush >= 0.8 * shared && short >= 0.8 * shared && rightOnly < shared;
    if (tabs) right -= sharedRight;
    if (straddling > straddleAllowance || left + right === 0) continue;
    found.push({ ratio: Math.min(left, right) / (left + right), split, tabs, straddling });
  }

  // The share is the best one found; where the text is split to be read is, among the splits
  // that come close to it, the one fewest runs cross, so a line is read whole only when it has
  // to be.
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

/** `findGutter`'s share alone: 0 when no gutter is found, `null` when the page cannot say. */
export const measureColumns = (runs: readonly PositionedRun[], pageWidth: number) =>
  findGutter(runs, pageWidth)?.ratio ?? null;
