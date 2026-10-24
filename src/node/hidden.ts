/**
 * Text a reader cannot see but an ATS reads: the PDF tricks behind "white fonting". This replays
 * pdf.js's operator list, keeping the graphics state a renderer keeps, and calls a run hidden when
 * a person looking at the page would not see it:
 *
 * - invisible render mode (`3 Tr`), unless over an image that is not blank (the OCR layer of a
 *   scan);
 * - fully transparent (`ca 0`), unless the same text is drawn visibly in the same place (the
 *   selectable copy Chrome lays over text with a shadow, outline or gradient fill);
 * - smaller than 2pt;
 * - in an optional content layer (`/OC`) the document turns off;
 * - wholly outside the clip (the page, a form's box, the paths `W` clips to, each by its bounds);
 * - within 1.25:1 contrast of what lies beneath, after its blend mode: the topmost shape or blank
 *   image filled before it (blended by its opacity with what lies under it; a border's inside is
 *   not its fill), else the white page (a picture, gradient or pattern leaves the background
 *   unknown: benefit of the doubt);
 * - on translucent fills of its own colour that together cover 70% or more of what lies beneath;
 * - covered by an image or an opaque shape drawn after it. A shape drawn in a blend mode covers it
 *   only when, blended with the text and what lies beneath alike, they are within 1.25:1 (a
 *   highlighter's Multiply leaves dark text dark); one in a mode this does not know covers nothing.
 *
 * Measured, not certain: path-drawn glyphs, clips that are not rectangles and shapes drawn in a
 * blend mode can still hide text this does not see. It errs on the side of not accusing anyone.
 */

import { indexDrawn, OPAQUE, type Box, type Drawn } from "./surroundings.js";
import { countRuledTables, pathRules } from "./tables.js";

export type { Box };

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const MIN_SIZE = 2;
export const MIN_CONTRAST = 1.25;
/**
 * Translucent fills of the text's own colour that cover this much of what lies beneath them hide
 * it: at 70%, black text on black over white has 2.5:1 contrast, and over anything else less.
 */
const OWN_COLOUR = 0.7;

function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

const apply = (m: Matrix, x: number, y: number): [number, number] => [
  m[0] * x + m[2] * y + m[4],
  m[1] * x + m[3] * y + m[5],
];

function boxThrough(m: Matrix, [x0, y0, x1, y1]: Box): Box {
  const corners = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)];
  const xs = corners.map((c) => c[0]);
  const ys = corners.map((c) => c[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

/** pdf.js hands numbers over as an array or a typed array, by version. */
const isList = (value: unknown): value is ArrayLike<number> =>
  Array.isArray(value) || ArrayBuffer.isView(value);

/** Relative luminance of a "#rrggbb" colour (WCAG 2). */
function luminance(hex: string) {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** The WCAG 2 contrast ratio of two "#rrggbb" colours. */
export function contrast(a: string, b: string) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * Blend modes, as pdf.js names them, that can leave what lies beneath as it was: a channel of what
 * is painted (`t`) over one beneath (`b`), from 0 to 1. Any other is read as normal.
 */
const BLENDS: Record<string, (t: number, b: number) => number> = {
  multiply: (t, b) => t * b,
  screen: (t, b) => t + b - t * b,
  darken: Math.min,
  lighten: Math.max,
  difference: (t, b) => Math.abs(t - b),
  exclusion: (t, b) => t + b - 2 * t * b,
};

/** The "#rrggbb" seen where `over` is painted at opacity `alpha`, in blend mode `mode`, on `under`. */
export function paintOver(over: string, under: string, alpha = 1, mode = "") {
  const a = Math.min(1, Math.max(0, alpha));
  const f = BLENDS[mode] ?? ((t: number) => t);
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16) / 255;
  return `#${[1, 3, 5]
    .map((at) => {
      const b = channel(under, at);
      return Math.round(255 * (a * f(channel(over, at), b) + (1 - a) * b))
        .toString(16)
        .padStart(2, "0");
    })
    .join("")}`;
}

/** A filled path's rectangles split into boxes; past this many, it is read as its bounding box. */
const MAX_SUBPATHS = 8;

/**
 * The corners of an upright rectangle, or null: 4 points (5 when the first is repeated), each side
 * level or plumb. `turn` is its winding, 0 when it encloses nothing (a path out and back along
 * the same line, or a rectangle of no width or height).
 */
function rectangle(points: ReadonlyArray<[number, number]>): { box: Box; turn: number } | null {
  const corners =
    points.length === 5 && points[4]![0] === points[0]![0] && points[4]![1] === points[0]![1]
      ? points.slice(0, 4)
      : points;
  if (corners.length !== 4) return null;
  let area = 0;
  for (let index = 0; index < 4; index += 1) {
    const [x0, y0] = corners[index]!;
    const [x1, y1] = corners[(index + 1) % 4]!;
    if (Math.abs(x1 - x0) > 1e-6 && Math.abs(y1 - y0) > 1e-6) return null;
    // Twice the signed area: its sign is the rectangle's winding.
    area += x0 * y1 - x1 * y0;
  }
  const [[ax, ay], [bx, by]] = [corners[0]!, corners[2]!];
  return {
    box: [Math.min(ax, bx), Math.min(ay, by), Math.max(ax, bx), Math.max(ay, by)],
    turn: Math.abs(area) < 1e-6 ? 0 : Math.sign(area),
  };
}

/**
 * What a filled path of upright rectangles covers, as boxes in page space, by each rectangle's
 * winding: a frame (`re re f*`, a bordered box) is its four sides, not the box around it.
 * `holes`: the gaps it leaves inside its bounding box (a frame's inside), counted as boxes.
 * `undefined` for any other path (a curve, a slanted side, more than `MAX_SUBPATHS` rectangles),
 * or when `budget` (boxes and holes, shared across a page) runs out: the caller reads it as its
 * bounding box in its fill, as a solid shape. Each path split costs at least one box, so the work
 * is bounded too: a grid of `2 * MAX_SUBPATHS` edges each way, each cell against every rectangle.
 */
function filledBoxes(
  data: ArrayLike<number>,
  toPage: (x: number, y: number) => [number, number],
  evenOdd: boolean,
  budget: { boxes: number },
): { boxes: Box[]; holes: Box[] } | undefined {
  const subpaths: Array<{ box: Box; turn: number }> = [];
  let points: Array<[number, number]> = [];
  const close = () => {
    if (!points.length) return true;
    const found = rectangle(points);
    points = [];
    if (!found) return false;
    // One that encloses nothing fills nothing and cuts no hole.
    if (found.turn) subpaths.push(found);
    return subpaths.length <= MAX_SUBPATHS;
  };
  const point = (at: number) => toPage(Number(data[at]), Number(data[at + 1]));
  for (let at = 0; at < data.length;) {
    const code = data[at];
    if (code === 0) {
      if (!close()) return undefined;
      points.push(point(at + 1));
      at += 3;
    } else if (code === 1) {
      // A rectangle has five points at most: past that, no need to keep reading.
      if (points.push(point(at + 1)) > 5) return undefined;
      at += 3;
    } else if (code === 3) at += 1;
    else return undefined;
  }
  if (!close()) return undefined;
  if (subpaths.length <= 1)
    return subpaths.length ? { boxes: [subpaths[0]!.box], holes: [] } : undefined;

  if (budget.boxes <= 0) return undefined;
  const edges = (low: 0 | 1, high: 2 | 3) =>
    [...new Set(subpaths.flatMap(({ box }) => [box[low], box[high]]))].sort((a, b) => a - b);
  const [xs, ys] = [edges(0, 2), edges(1, 3)];
  const boxes: Box[] = [];
  const holes: Box[] = [];
  for (let row = 0; row + 1 < ys.length; row += 1) {
    const y = (ys[row]! + ys[row + 1]!) / 2;
    const filled = xs.slice(1).map((right, column) => {
      const x = (xs[column]! + right) / 2;
      let winding = 0;
      for (const { box, turn } of subpaths)
        if (x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]) winding += turn;
      return evenOdd ? winding % 2 !== 0 : winding !== 0;
    });
    // Each run of filled or empty cells along the row is one box.
    for (let from = 0, to = 1; to <= filled.length; to += 1)
      if (to === filled.length || filled[to] !== filled[from]) {
        (filled[from] ? boxes : holes).push([xs[from]!, ys[row]!, xs[to]!, ys[row + 1]!]);
        from = to;
      }
  }
  return (budget.boxes -= boxes.length + holes.length) < 0 ? undefined : { boxes, holes };
}

/**
 * `fill` and `stroke` are "#rrggbb", or "" when not flat (a pattern, a gradient). `alpha` and
 * `strokeAlpha` are `ca` and `CA`. `softMask`: a soft mask is in force, so what is painted may show
 * through anywhere or nowhere. `lineWidth` is the pen (`w`) in user space. `blend` is the blend
 * mode, as pdf.js names it, or "" when normal. `clip` bounds what may show, in page space: the page, narrowed by each
 * clip set since. The text state (`Tf`, `Tz` as a factor, `TL`, `Tr`) is saved and restored by
 * `q`/`Q` too.
 */
type GraphicsState = {
  ctm: Matrix;
  fill: string;
  stroke: string;
  alpha: number;
  strokeAlpha: number;
  softMask: boolean;
  blend: string;
  clip: Box;
  lineWidth: number;
  fontSize: number;
  hScale: number;
  leading: number;
  mode: number;
};
type Run = {
  text: string;
  center: [number, number];
  /** Where its first glyph starts, on its baseline. */
  origin: [number, number];
  box: Box;
  order: number;
  size: number;
  /** In optional content the document turns off. */
  off: boolean;
  /** Text space to page space: a point along the run is `[advance, fontSize * share]` through it. */
  device: Matrix;
  /** Its width in text space. */
  advance: number;
  /** Each glyph's characters (`from`, `to` in `text`) and the advance to its middle. */
  glyphs: Array<{ from: number; to: number; at: number }>;
} & GraphicsState;

/**
 * `images`: where each image was drawn, in page points. `marks`: small filled shapes (list markers
 * Chrome draws as paths) in page points. `tables`: ruled tables (`countRuledTables`).
 * `invisibleChars`: of `textChars`, those in an invisible render mode, as a scan's OCR layer.
 */
export type PageVisibility = {
  textChars: number;
  invisibleChars: number;
  hidden: string[];
  images: Box[];
  marks: Box[];
  tables: number;
};

/** Shapes no larger than this many points may be list markers; at most `MAX_MARKS` are kept. */
const MARK_SIZE = 12;
const MAX_MARKS = 2_000;

/** Soft-mask glyph/paint pairs matched; past this the rest are taken as painted visibly. */
const MAX_MASK_PAIRS = 100_000;
/**
 * Soft-mask glyphs checked against what is painted through the mask, across a page: each paint
 * checks every glyph, so 24,000 of each took 6 to 21 s. Past this, a mask's glyphs are taken as
 * painted visibly.
 */
const MAX_MASK_CHECKS = 2_000_000;
/** Point checks spent looking inside runs seen at their middle (`hiddenStretches`), across a page. */
const MAX_STRETCH_CHECKS = 10_000_000;
/** Visible glyphs transparent runs are compared with, across a page; past this the rest are not. */
const MAX_PIECE_CHECKS = 2_000_000;
/**
 * Boxes and holes filled paths are split into, across a page. Each is a shape every run near it
 * is checked against: past the cap, a path is one box.
 */
const MAX_FILL_BOXES = 2_000;
/** Translucent fills looked through, one over another; the last is read as opaque. */
const MAX_LAYERS = 4;

/** A run's text and where it is, to a 2pt cell `dx`, `dy` cells away. */
const cell = (text: string, [x, y]: [number, number], dx = 0, dy = 0) =>
  `${text.trim()}|${Math.round(x / 2) + dx}|${Math.round(y / 2) + dy}`;

/** A `beginGroup`/`endGroup` that brackets a soft mask's content: pdf.js gives it `smask`. */
const isSoftMaskGroup = (options: unknown) =>
  !!options && typeof options === "object" && !!(options as { smask?: unknown }).smask;

/** pdf.js's `OPS` table, and the operator list of one page. */
type Ops = Record<string, number>;
type OperatorList = { fnArray: number[]; argsArray: unknown[][] };

/**
 * pdf.js paints an image with its own mask (`/SMask`, colour-key or stencil `/Mask`) as `save`,
 * `setGState [["SMask", false]]`, the image, `restore`: the only trace of the mask, the same for a
 * mask that hides nothing.
 */
function ownMask(ops: Ops, list: OperatorList, order: number) {
  let before = order - 1;
  if (list.fnArray[before] === ops.beginMarkedContentProps) before -= 1;
  const entries = list.argsArray[before]?.[0];
  return (
    list.fnArray[before] === ops.setGState &&
    list.fnArray[before - 1] === ops.save &&
    Array.isArray(entries) &&
    entries.length === 1 &&
    Array.isArray(entries[0]) &&
    entries[0][0] === "SMask" &&
    entries[0][1] === false
  );
}

/** pdf.js's store of a page's decoded images: `objs`, and `commonObjs` for the `g_` ones. */
type ObjectStore = { get(objId: string, callback: (data: unknown) => void): unknown };
export type PageObjects = { objs: ObjectStore; commonObjs: ObjectStore };

/**
 * What a decoded image lets show: null when a pixel's alpha is below `OPAQUE` (as a translucent
 * shape lets what is under it show) or its pixels are unreadable (a bitmap, or none: the benefit
 * of the doubt); else its colour ("#rrggbb") when it is one colour throughout, so it shows no
 * words; else "". pdf.js's ImageKind: 1 a bit a pixel and 2 RGB, both opaque (a 1-bit image is not
 * read for a colour); 3 RGBA. Linear: the colour is read up to the first pixel that differs.
 */
function pixelsOf(image: unknown): string | null {
  const { kind, data } = (image ?? {}) as { kind?: unknown; data?: unknown };
  if (kind === 1) return "";
  if (!(data instanceof Uint8ClampedArray) || (kind !== 2 && kind !== 3)) return null;
  const step = kind === 2 ? 3 : 4;
  if (step > 3)
    for (let at = 3; at < data.length; at += 4) if (data[at]! < 255 * OPAQUE) return null;
  if (data.length < step) return "";
  for (let at = step; at < data.length; at += 1) if (data[at] !== data[at % step]) return "";
  return `#${((1 << 24) | (data[0]! << 16) | (data[1]! << 8) | data[2]!).toString(16).slice(1)}`;
}

/**
 * What each image a page paints lets show (`pixelsOf`), by id. Pass the result to
 * `measureVisibility`.
 *
 * pdf.js sends an image's pixels apart from the operator list, possibly after it, so this waits for
 * each (`waitMs` at most); pixels that do not arrive are unreadable.
 *
 * It waits for every image: a page closed before its images decode leaves them decoding behind it
 * (six 48 MP pages held 1.4 GB). Images in a pattern, a Type3 glyph or a soft mask, or slower than
 * `waitMs`, still decode after the page.
 */
export async function readImages(
  ops: Ops,
  list: OperatorList,
  page: PageObjects,
  waitMs = 2_000,
): Promise<Map<string, string | null>> {
  const ids = new Set<string>();
  list.fnArray.forEach((fn, order) => {
    const id = list.argsArray[order]?.[0];
    if (fn === ops.paintImageXObject && typeof id === "string") ids.add(id);
  });
  const pixels = new Map<string, string | null>();
  await Promise.all(
    [...ids].map(async (id) => {
      const store = id.startsWith("g_") ? page.commonObjs : page.objs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const image = await Promise.race([
        new Promise<unknown>((resolve) => store.get(id, resolve)),
        new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), waitMs))),
      ]).finally(() => clearTimeout(timer));
      pixels.set(id, pixelsOf(image));
    }),
  );
  return pixels;
}

/** Thrown by `measureVisibility` for a page too crowded to measure, with the ruled tables it counted first. */
export class CrowdedPage extends Error {
  constructor(
    cause: unknown,
    readonly tables: number,
  ) {
    super((cause as Error)?.message, { cause });
  }
}

/** pdf.js's optional content configuration: which layers (`/OC` groups) the document shows. */
export type OptionalContent = { isVisible(group: unknown): boolean };

/**
 * `pixels`: what the page's images let show (`readImages`); without it every masked image is
 * see-through and only inline images can be blank. `optionalContent`: the document's layers
 * (`getOptionalContentConfig`); text in a layer turned off is hidden, and what a layer turned off
 * paints covers nothing. Without it every layer shows.
 */
export function measureVisibility(
  ops: Ops,
  list: OperatorList,
  pageBox: Box,
  pixels?: ReadonlyMap<string, string | null>,
  optionalContent?: OptionalContent,
): PageVisibility {
  const stack: GraphicsState[] = [];
  const initial: GraphicsState = {
    ctm: IDENTITY,
    fill: "#000000",
    stroke: "#000000",
    alpha: 1,
    strokeAlpha: 1,
    softMask: false,
    blend: "",
    clip: pageBox,
    lineWidth: 1,
    fontSize: 0,
    // Horizontal scaling (`Tz`), as a factor: it narrows glyphs and their advance alike.
    hScale: 1,
    leading: 0,
    mode: 0,
  };
  let state = initial;
  let textMatrix: Matrix = IDENTITY;
  let lineMatrix: Matrix = IDENTITY;
  // The last path built, in page space: a shading (`sh`) fills the clip it sets.
  let lastPath: Box | null = null;
  const set = (change: Partial<GraphicsState>) => void (state = { ...state, ...change });
  const transform = (matrix: ArrayLike<number>) =>
    set({ ctm: multiply(state.ctm, Array.from(matrix) as Matrix) });
  // A `W` or `W*` seen: the next path narrows the clip. pdf.js lists it before the path.
  let clipNext = false;
  /** Narrows the clip to a box in page space. A NaN corner leaves it unknown: it hides nothing. */
  const clipTo = ([x0, y0, x1, y1]: Box) => {
    const [cx0, cy0, cx1, cy1] = state.clip;
    set({ clip: [Math.max(cx0, x0), Math.max(cy0, y0), Math.min(cx1, x1), Math.min(cy1, y1)] });
  };
  // Inside a soft mask's own content: listed among the page's operators, but not painted.
  let maskDepth = 0;
  // Open marked content, each whether its layer shows (pdf.js paints only where all do), and how
  // many of them do not.
  const marked: boolean[] = [];
  let offDepth = 0;

  const drawn: Drawn[] = [];
  const runs: Run[] = [];
  const marks: Box[] = [];
  // Where glyphs were drawn as a soft mask (gradient text) or visibly: a transparent copy of
  // either is the selectable layer of a text effect.
  const drawnGlyphs = new Set<string>();
  // The glyphs of the soft mask being built or in force. They show only where what is painted
  // through the mask stands out from what lies under it.
  let maskGlyphs: Array<{ text: string; center: [number, number] }> = [];
  const throughMask: Array<{
    text: string;
    center: [number, number];
    fill: string;
    order: number;
  }> = [];
  // Glyphs checked so far, and whether the mask in force is past the budget and taken as visible.
  let maskChecks = 0;
  let maskSpent = false;
  /** Something painted, unless it only builds a soft mask. */
  const paint = (item: Omit<Drawn, "alpha">, masked = state.softMask) => {
    if (maskDepth || offDepth) return;
    if (state.softMask && !maskSpent && (maskChecks += maskGlyphs.length) > MAX_MASK_CHECKS) {
      for (const glyph of maskGlyphs) drawnGlyphs.add(cell(glyph.text, glyph.center));
      maskSpent = true;
    }
    if (state.softMask && !maskSpent)
      for (const glyph of maskGlyphs) {
        const [x, y] = glyph.center;
        const [x0, y0, x1, y1] = item.box;
        if (throughMask.length >= MAX_MASK_PAIRS) drawnGlyphs.add(cell(glyph.text, glyph.center));
        else if (x >= x0 && x <= x1 && y >= y0 && y <= y1)
          throughMask.push({
            ...glyph,
            fill: item.kind === "shape" ? item.fill : "",
            order: item.order,
          });
      }
    // Through a mask it may show anywhere or nowhere: it covers nothing for certain, and text on
    // it has no known background. A blend mode not modelled here covers as a normal fill does.
    drawn.push(
      masked
        ? { ...item, fill: "", alpha: 0 }
        : { ...item, alpha: state.alpha, blend: BLENDS[state.blend] ? state.blend : "" },
    );
  };
  /** An image's own mask lets what is under it show — unless its pixels say it hides nothing. */
  const masksItself = (fn: number, order: number) => {
    if (!ownMask(ops, list, order)) return false;
    const id = list.argsArray[order]?.[0];
    if (!pixels || fn !== ops.paintImageXObject || typeof id !== "string") return true;
    return pixels.get(id) === null;
  };
  const isFill = new Set([ops.fill, ops.eoFill, ops.fillStroke, ops.eoFillStroke]);
  const fillsRules = new Set([...isFill, ops.closeFillStroke, ops.closeEOFillStroke]);
  const strokes = new Set([
    ops.stroke,
    ops.closeStroke,
    ops.fillStroke,
    ops.eoFillStroke,
    ops.closeFillStroke,
    ops.closeEOFillStroke,
  ]);
  // Thin lines and bars, in page space, for `countRuledTables`.
  const rules: Box[] = [];
  const fillBudget = { boxes: MAX_FILL_BOXES };
  const isImage = new Set(
    [
      ops.paintImageXObject,
      ops.paintInlineImageXObject,
      ops.paintImageMaskXObject,
      ops.paintImageXObjectRepeat,
      ops.paintJpegXObject,
      ops.paintInlineImageXObjectGroup,
    ].filter((op) => op !== undefined),
  );

  const moveText = (tx: number, ty: number) => {
    lineMatrix = multiply(lineMatrix, [1, 0, 0, 1, tx, ty]);
    textMatrix = lineMatrix;
  };

  const show = (glyphs: unknown, order: number) => {
    if (!Array.isArray(glyphs)) return;
    const { fontSize, hScale } = state;
    let text = "";
    let advance = 0;
    const placed: Run["glyphs"] = [];
    for (const glyph of glyphs) {
      if (typeof glyph === "number") advance -= (glyph / 1000) * fontSize;
      else if (glyph && typeof glyph === "object") {
        const { unicode, width } = glyph as { unicode?: string; width?: number };
        const wide = ((width ?? 0) / 1000) * fontSize;
        const from = text.length;
        text += unicode ?? "";
        placed.push({ from, to: text.length, at: (advance + wide / 2) * hScale });
        advance += wide;
      }
    }
    advance *= hScale;
    const device = multiply(state.ctm, textMatrix);
    // A glyph prints as small as its narrower side (`1 Tz` leaves 10pt text a hairline wide).
    const scale = Math.min(
      Math.hypot(device[0], device[1]) * Math.abs(hScale),
      Math.hypot(device[2], device[3]),
    );
    const box = boxThrough(device, [0, 0, advance, fontSize]);
    textMatrix = multiply(textMatrix, [1, 0, 0, 1, advance, 0]);
    const center: [number, number] = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
    if (!text.trim()) return;
    if (maskDepth) return void maskGlyphs.push({ text, center });
    runs.push({
      ...state,
      text,
      off: offDepth > 0,
      origin: apply(device, 0, 0),
      // No font size set is no size known (NaN, never tiny); a zero scale (`0 Tz`) leaves no size.
      size: fontSize ? Math.abs(fontSize) * scale : Number.NaN,
      box,
      center,
      order,
      device,
      advance,
      glyphs: placed,
    });
  };

  list.fnArray.forEach((fn, order) => {
    const args = list.argsArray[order] ?? [];
    if (fn === ops.save) stack.push({ ...state });
    else if (fn === ops.restore) state = stack.pop() ?? state;
    else if (fn === ops.transform) transform(args as ArrayLike<number>);
    // A form XObject is drawn inside its own `q … Q`, through its own matrix, clipped to its box.
    else if (fn === ops.paintFormXObjectBegin) {
      stack.push({ ...state });
      const [matrix, bbox] = args;
      if (isList(matrix)) transform(matrix);
      if (isList(bbox) && bbox.length === 4) clipTo(boxThrough(state.ctm, Array.from(bbox) as Box));
    } else if (fn === ops.paintFormXObjectEnd || fn === ops.endAnnotation)
      state = stack.pop() ?? state;
    // An annotation is drawn after the page, as pdf.js draws it: from a fresh state, clipped to
    // its rectangle, its appearance placed through `transform × matrix`. Nothing the page set
    // without `q` (a clip, a colour, a transparency) reaches it.
    else if (fn === ops.beginAnnotation) {
      stack.push({ ...state });
      const [, rect, place, matrix] = args;
      state = initial;
      clipNext = false;
      lastPath = null;
      if (isList(rect) && rect.length === 4) {
        const [x0, y0, x1, y1] = Array.from(rect);
        clipTo([Math.min(x0!, x1!), Math.min(y0!, y1!), Math.max(x0!, x1!), Math.max(y0!, y1!)]);
      }
      if (isList(place)) transform(place);
      if (isList(matrix)) transform(matrix);
    } else if (fn === ops.beginMarkedContent || fn === ops.beginMarkedContentProps) {
      const [tag, properties] = args;
      const shows =
        fn !== ops.beginMarkedContentProps ||
        tag !== "OC" ||
        (optionalContent?.isVisible(properties) ?? true);
      marked.push(shows);
      if (!shows) offDepth += 1;
    } else if (fn === ops.endMarkedContent) {
      if (marked.pop() === false) offDepth -= 1;
    } else if (fn === ops.clip || fn === ops.eoClip) clipNext = true;
    else if ((fn === ops.beginGroup || fn === ops.endGroup) && isSoftMaskGroup(args[0])) {
      // A new mask's glyphs replace the last one's.
      if (fn === ops.beginGroup && !maskDepth) [maskGlyphs, maskSpent] = [[], false];
      maskDepth = Math.max(0, maskDepth + (fn === ops.beginGroup ? 1 : -1));
    } else if (fn === ops.setFillRGBColor && typeof args[0] === "string") set({ fill: args[0] });
    else if (fn === ops.setStrokeRGBColor && typeof args[0] === "string") set({ stroke: args[0] });
    // pdf.js turns every flat colour into RGB; what is left for `scn` is a pattern.
    else if (fn === ops.setFillColorN) set({ fill: "" });
    else if (fn === ops.setStrokeColorN) set({ stroke: "" });
    else if (fn === ops.setGState && Array.isArray(args[0]))
      for (const entry of args[0] as unknown[]) {
        if (!Array.isArray(entry)) continue;
        const [key, value] = entry as [unknown, unknown];
        if (key === "ca" && typeof value === "number") set({ alpha: value });
        else if (key === "CA" && typeof value === "number") set({ strokeAlpha: value });
        else if (key === "SMask") set({ softMask: value === true });
        else if (key === "BM" && typeof value === "string")
          set({ blend: value === "source-over" ? "" : value });
        else if (key === "LW" && typeof value === "number") set({ lineWidth: value });
      }
    else if (fn === ops.setLineWidth) set({ lineWidth: Number(args[0]) || 0 });
    else if (fn === ops.beginText) textMatrix = lineMatrix = IDENTITY;
    else if (fn === ops.setFont) set({ fontSize: Number(args[1]) || 0 });
    else if (fn === ops.setHScale)
      set({ hScale: Number.isFinite(Number(args[0])) ? Number(args[0]) / 100 : 1 });
    else if (fn === ops.setTextRenderingMode) set({ mode: Number(args[0]) || 0 });
    else if (fn === ops.setLeading) set({ leading: Number(args[0]) || 0 });
    else if (fn === ops.moveText) moveText(Number(args[0]), Number(args[1]));
    else if (fn === ops.setLeadingMoveText) {
      set({ leading: -Number(args[1]) });
      moveText(Number(args[0]), Number(args[1]));
    } else if (fn === ops.setTextMatrix) {
      // pdf.js passes the matrix as a typed array, wrapped or not by version.
      const inner = args[0];
      textMatrix = lineMatrix = Array.from((isList(inner) ? inner : args) as ArrayLike<number>).map(
        Number,
      ) as Matrix;
    } else if (fn === ops.nextLine) moveText(0, -state.leading);
    else if (fn === ops.showText || fn === ops.showSpacedText) show(args[0], order);
    else if (fn === ops.nextLineShowText || fn === ops.nextLineSetSpacingShowText) {
      moveText(0, -state.leading);
      show(args[args.length - 1], order);
    } else if (fn === ops.constructPath) {
      // pdf.js gives the path itself as `[Float32Array]`, in user space.
      const data = (args[1] as unknown[] | undefined)?.[0];
      const op = args[0] as number;
      const [filled, stroked] = [
        fillsRules.has(op) && state.alpha > 0,
        strokes.has(op) && state.strokeAlpha > 0,
      ];
      if (!maskDepth && !offDepth && (filled || stroked) && isList(data)) {
        const [a, b, c, d] = state.ctm;
        pathRules(
          data,
          (x, y) => apply(state.ctm, x, y),
          filled,
          stroked ? state.lineWidth * Math.sqrt(Math.abs(a * d - b * c)) : undefined,
          rules,
        );
      }
      const bounds = args[2];
      const clips = clipNext;
      clipNext = false;
      if (isList(bounds)) {
        lastPath = boxThrough(state.ctm, Array.from(bounds) as Box);
        // What a path clips to lies within its bounds: text wholly outside them is not drawn.
        if (clips) clipTo(lastPath);
        if (isFill.has(op)) {
          const split = isList(data)
            ? filledBoxes(
                data,
                (x, y) => apply(state.ctm, x, y),
                op === ops.eoFill || op === ops.eoFillStroke,
                fillBudget,
              )
            : undefined;
          // Any other path is read as its bounding box, solid: a curve or a cheap pile of moves
          // must not leave white text on it unjudged.
          for (const box of split?.boxes ?? [lastPath])
            paint({ box, order, kind: "shape", fill: state.fill });
          // A hole paints nothing; under a soft mask its path may show anywhere or nowhere.
          if (!maskDepth && !offDepth)
            for (const box of split?.holes ?? [])
              drawn.push({
                box,
                order,
                kind: "hole",
                fill: state.softMask ? "" : state.fill,
                alpha: state.softMask ? 0 : state.alpha,
              });
          const [mx0, my0, mx1, my1] = lastPath;
          if (
            !maskDepth &&
            !offDepth &&
            state.alpha > 0 &&
            marks.length < MAX_MARKS &&
            Math.max(mx1 - mx0, my1 - my0) <= MARK_SIZE
          )
            marks.push(lastPath);
        }
      }
    } else if (fn === ops.shadingFill)
      // A gradient banner: its colour varies, so text on it is not judged by contrast.
      paint({ box: lastPath ?? pageBox, order, kind: "shading", fill: "" });
    // A one-pixel stencil mask (`BI /IM true`) paints its unit square in the fill colour.
    else if (fn === ops.paintSolidColorImageMask)
      paint({ box: boxThrough(state.ctm, [0, 0, 1, 1]), order, kind: "shape", fill: state.fill });
    else if (isImage.has(fn)) {
      // A blank image is a shape of its colour; any other's colour is unknown.
      const image = args[0];
      const fill = (typeof image === "string" ? pixels?.get(image) : pixelsOf(image)) ?? "";
      paint(
        { box: boxThrough(state.ctm, [0, 0, 1, 1]), order, kind: "image", fill },
        state.softMask || masksItself(fn, order),
      );
    }
  });

  // Counted before the index can give up on a crowded page: its tables are still tables.
  const tables = countRuledTables(
    rules,
    runs.map((run) => run.center),
  );
  const index = indexDrawn(
    drawn,
    [...runs.map((run) => run.center), ...throughMask.map((glyph) => glyph.center)],
    pageBox,
  );
  // Points inside runs (`hiddenStretches`) are looked up in an index of their own, spanning every
  // run's box, with its own budget: past it they are no longer looked for, and the page is still
  // measured.
  let stretchIndex: typeof index | undefined;
  let inStretch = false;
  const around: typeof index = (point, order) => {
    if (inStretch) {
      stretchIndex ??= indexDrawn(
        drawn,
        runs.flatMap(({ box }): Array<[number, number]> => [
          [box[0], box[1]],
          [box[2], box[3]],
        ]),
        pageBox,
        MAX_STRETCH_CHECKS,
      );
      return stretchIndex(point, order);
    }
    try {
      return index(point, order);
    } catch (error) {
      throw new CrowdedPage(error, tables);
    }
  };
  // The colour seen at a point under `top`, the last fill there: blended by its opacity with what
  // lies beneath it, else the white page; "" when unknown. `through`: how much of this layer the
  // fills above it let show. A fill counts as opaque once what lies beneath it would show no more
  // than an `OPAQUE` cover lets through (under a 99% fill, or four 50% ones), or past
  // `MAX_LAYERS`: a picture under such layers must not leave the background unknown.
  const shown = (
    point: [number, number],
    top: Drawn | undefined,
    depth = 0,
    through = 1,
  ): string => {
    if (!top) return "#ffffff";
    const beneath = through * (1 - top.alpha);
    if (top.fill === "" || !(beneath > 1 - OPAQUE) || depth >= MAX_LAYERS) return top.fill;
    const under = shown(point, around(point, top.order).top, depth + 1, beneath);
    return under && paintOver(top.fill, under, top.alpha);
  };
  // How much of `colour` the fills under a point lay down, from `top` down while each is within
  // `MIN_CONTRAST` of it: one 85% box, or three 50% ones, of the text's own colour.
  const ownCover = (point: [number, number], top: Drawn | undefined, colour: string) => {
    let left = 1;
    for (let layer = top, depth = 0; layer && depth <= MAX_LAYERS; depth += 1) {
      if (layer.fill === "" || contrast(colour, layer.fill) >= MIN_CONTRAST) break;
      left *= 1 - Math.min(1, Math.max(0, layer.alpha));
      layer = around(point, layer.order).top;
    }
    return 1 - left;
  };
  // Whether `colour`, painted in blend mode `mode`, is lost against what lies under a point: within
  // `MIN_CONTRAST` of it, or on fills of its own colour that cover `OWN_COLOUR` or more, whatever
  // lies beneath them.
  const lost = (point: [number, number], top: Drawn | undefined, colour: string, mode = "") => {
    if (colour === "") return false;
    const background = shown(point, top);
    if (
      background !== "" &&
      contrast(paintOver(colour, background, 1, mode), background) < MIN_CONTRAST
    )
      return true;
    return ownCover(point, top, colour) >= OWN_COLOUR;
  };
  // Whether `colour`, painted in blend mode `mode`, is lost once `over` (opaque fills drawn after it
  // in a blend mode) are blended with it and with what lies beneath alike: a white Screen hides
  // black text, a yellow Multiply does not. A fill of unknown colour or blend mode hides nothing.
  const blendedAway = (
    point: [number, number],
    top: Drawn | undefined,
    colour: string,
    mode: string,
    over: Drawn[],
  ) => {
    let under = shown(point, top);
    if (!colour || !under) return false;
    let text = paintOver(colour, under, 1, mode);
    for (const { fill, alpha, blend = "" } of over) {
      if (!fill || !BLENDS[blend]) return false;
      [text, under] = [paintOver(fill, text, alpha, blend), paintOver(fill, under, alpha, blend)];
    }
    return contrast(text, under) < MIN_CONTRAST;
  };
  for (const { text, center, fill, order } of throughMask)
    if (!lost(center, around(center, order).top, fill)) drawnGlyphs.add(cell(text, center));
  // What the render mode paints glyphs with: outline in modes 1 and 5, outline and fill in 2 and 6
  // (seen if either is), else fill.
  const paintsOf = (run: Run) => [
    ...(run.mode % 4 === 1 ? [] : [{ colour: run.fill, alpha: run.alpha }]),
    ...(run.mode % 4 === 1 || run.mode % 4 === 2
      ? [{ colour: run.stroke, alpha: run.strokeAlpha }]
      : []),
  ];
  const transparentRun = (run: Run) => paintsOf(run).every(({ alpha }) => alpha === 0);
  // Visible runs by baseline, in order along it: Chrome draws an outline a glyph at a time and its
  // transparent copy in pieces, in fonts of differing widths, so a piece is matched by the glyphs
  // that start within it.
  const lines = new Map<number, Run[]>();
  for (const run of runs)
    if (run.mode % 4 !== 3 && !transparentRun(run) && !run.off) {
      drawnGlyphs.add(cell(run.text, run.center));
      const key = Math.round(run.origin[1]);
      if (lines.has(key)) lines.get(key)!.push(run);
      else lines.set(key, [run]);
    }
  for (const line of lines.values()) line.sort((a, b) => a.origin[0] - b.origin[0]);
  let checks = 0;
  const copied = (run: Run) => {
    const [x, y] = run.origin;
    // Glyphs are taken in order from where the piece starts until they spell as many characters.
    const end = run.box[2] + run.size;
    const bare = (text: string) => text.replace(/\s/g, "");
    const target = bare(run.text);
    const pieces: Run[] = [];
    for (const key of [-1, 0, 1]) {
      const line = lines.get(Math.round(y) + key) ?? [];
      let low = 0;
      let high = line.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (line[middle]!.origin[0] < x - 0.5) low = middle + 1;
        else high = middle;
      }
      for (let at = low; at < line.length && line[at]!.origin[0] < end; at += 1) {
        if ((checks += 1) > MAX_PIECE_CHECKS) return false;
        if (Math.abs(line[at]!.origin[1] - y) <= 1) pieces.push(line[at]!);
      }
    }
    pieces.sort((a, b) => a.origin[0] - b.origin[0]);
    let spelt = "";
    for (const piece of pieces) {
      if (spelt.length >= target.length) break;
      spelt += bare(piece.text);
    }
    return target !== "" && spelt === target;
  };

  // Where a quarter and three quarters of a run's width lie, on the line through its centre.
  const quarters = ({ box: [x0, , x1], center: [, y] }: Run): Array<[number, number]> => [
    [x0 + (x1 - x0) / 4, y],
    [x1 - (x1 - x0) / 4, y],
  ];

  // Whether what of a run lies at a point is hidden: under what is drawn after it, or, unless
  // `doubt` (its middle lies on an unknown background), lost against what lies under it there.
  const hiddenAt = (run: Run, point: [number, number], doubt: boolean) => {
    const { top, covered } = around(point, run.order);
    if (covered || doubt) return covered;
    return paintsOf(run).every(({ colour }) => lost(point, top, colour, run.blend));
  };
  // The point `advance` along a run and `share` of its font size up, on the page.
  const along = (run: Run, advance: number, share: number) =>
    apply(run.device, advance, run.fontSize * share);
  // Whether `MAX_STRETCH_CHECKS` is spent: no more runs are looked inside.
  let stretchesSpent = false;
  /**
   * The stretches of a run seen at its middle that are hidden all the same: a box drawn over half
   * of it, or two boxes of its colour under it either side of its middle. Read where a quarter of
   * its width or height in is hidden, then glyph by glyph: a glyph is hidden when it is a quarter
   * and three quarters up its height.
   */
  const hiddenStretches = (run: Run, top: Drawn | undefined): string[] => {
    if (stretchesSpent) return [];
    inStretch = true;
    try {
      const doubt = shown(run.center, top) === "";
      const corners = [0.25, 0.75].flatMap((x) =>
        [0.25, 0.75].map((y) => along(run, run.advance * x, y)),
      );
      if (!corners.some((point) => hiddenAt(run, point, doubt))) return [];
      return glyphStretches(run, doubt).stretches;
    } catch {
      stretchesSpent = true;
      return [];
    } finally {
      inStretch = false;
    }
  };
  // The stretches of a run whose glyphs are hidden, a glyph hidden when it is a quarter and three
  // quarters up its height; `all` when every glyph is.
  const glyphStretches = (run: Run, doubt: boolean) => {
    const stretches: string[] = [];
    let open = -1;
    let all = true;
    run.glyphs.forEach(({ from, at }, index) => {
      const shut = [0.25, 0.75].every((share) => hiddenAt(run, along(run, at, share), doubt));
      all &&= shut;
      if (shut && open < 0) open = from;
      if (!shut && open >= 0) stretches.push(run.text.slice(open, from));
      if (!shut) open = -1;
      if (shut && index === run.glyphs.length - 1) stretches.push(run.text.slice(open));
    });
    return { stretches: stretches.map((stretch) => stretch.trim()).filter(Boolean), all };
  };
  /**
   * The stretches hidden of a run hidden at its middle, when some of its glyphs still show: a box
   * over half a line hides that half, not the line (2026-10-24: a box over the end of a bullet took
   * the whole bullet, and its visible keywords, out of the match). Null when every glyph is hidden.
   */
  const partlyHidden = (run: Run, top: Drawn | undefined): string[] | null => {
    if (stretchesSpent || !run.glyphs.length) return null;
    inStretch = true;
    try {
      const { stretches, all } = glyphStretches(run, shown(run.center, top) === "");
      return all ? null : stretches;
    } catch {
      stretchesSpent = true;
      return null;
    } finally {
      inStretch = false;
    }
  };

  const hidden: string[] = [];
  let previous: Run | undefined;
  let textChars = 0;
  let invisibleChars = 0;
  for (const run of runs) {
    const chars = run.text.trim().length;
    textChars += chars;
    const at = around(run.center, run.order);
    const { overImage } = at;
    let { top, covered } = at;
    // A run whose centre lies in a frame's hole is in the frame, unless the frame lies under (or
    // over) both its quarter points: then the hole is under a few of its letters, and the rest
    // are on the frame, as if it had none.
    const { hole, holeOver } = at;
    if (hole && hole.order > (top?.order ?? -Infinity)) {
      const under = quarters(run).map((point) => around(point, run.order).top);
      if (under.every((shape) => shape?.order === hole.order)) top = under[0];
    }
    if (!covered && holeOver)
      covered = quarters(run).every((point) => around(point, run.order).covered);
    const paints = paintsOf(run);
    const { over } = at;
    if (!covered && over)
      covered = paints.every(({ colour }) => blendedAway(run.center, top, colour, run.blend, over));

    const unseen = run.mode === 3 || run.mode === 7;
    if (unseen) invisibleChars += chars;
    const invisible = unseen && !overImage;
    // Fully transparent, unless the same text is drawn where it lies (as glyphs or a gradient's
    // mask): Chrome's selectable copy hides nothing.
    const transparent =
      transparentRun(run) &&
      ![-1, 0, 1].some((dx) =>
        [-1, 0, 1].some((dy) => drawnGlyphs.has(cell(run.text, run.center, dx, dy))),
      ) &&
      !copied(run);
    const tiny = run.size < MIN_SIZE;
    // Off the page, or outside a clip: one with no area shows nothing.
    const [cx0, cy0, cx1, cy1] = run.clip;
    const clipped =
      cx1 <= cx0 ||
      cy1 <= cy0 ||
      run.box[2] < cx0 ||
      run.box[0] > cx1 ||
      run.box[3] < cy0 ||
      run.box[1] > cy1;
    // An unknown background, or text in a pattern, gets the benefit of the doubt.
    const blended = paints.every(({ colour }) => lost(run.center, top, colour, run.blend));

    if (!(invisible || transparent || tiny || clipped || blended || covered || run.off)) {
      // Seen at its middle; a stretch of it may still be hidden. Its own pieces: no run joins them.
      const stretches = unseen || transparentRun(run) ? [] : hiddenStretches(run, top);
      for (const stretch of stretches) hidden.push(stretch);
      if (stretches.length) previous = undefined;
      continue;
    }
    // Hidden at its middle by a plain box drawn over it or by its colour on what is under it, but
    // maybe not end to end. A hole or a blend is judged at the middle alone, as before: the glyph
    // check does not follow either.
    const plain = !hole && !holeOver && !over;
    if (
      plain &&
      (at.covered || blended) &&
      !(invisible || transparent || tiny || clipped || run.off)
    ) {
      const stretches = partlyHidden(run, top);
      if (stretches) {
        for (const stretch of stretches) hidden.push(stretch);
        previous = undefined;
        continue;
      }
    }
    // Runs one after another on a line are one text (Chrome draws a glyph at a time); a gap of a
    // space's width is a space.
    const gap = previous ? run.box[0] - previous.box[2] : NaN;
    if (
      previous &&
      Math.abs(run.box[1] - previous.box[1]) < run.size / 2 &&
      gap > -run.size / 2 &&
      gap < run.size
    )
      hidden[hidden.length - 1] += (gap > 0.15 * run.size ? " " : "") + run.text;
    else hidden.push(run.text);
    previous = run;
  }

  return {
    textChars,
    invisibleChars,
    hidden,
    images: drawn.filter((d) => d.kind === "image").map((d) => d.box),
    marks,
    tables,
  };
}
