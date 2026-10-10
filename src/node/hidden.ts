/**
 * Text a reader cannot see but an ATS reads: the PDF tricks behind "white fonting".
 *
 * Text extraction sees every glyph a PDF draws and nothing about how it looks, so a keyword list
 * in the page's own colour reads to an ATS exactly like a real skills section. This replays the
 * page's drawing operations — pdf.js's operator list — keeping the graphics state a renderer
 * keeps, and calls a run of text hidden when a person looking at the page would not see it:
 *
 * - invisible render mode (`3 Tr`), unless it lies over an image: that is the OCR text layer of
 *   a scan, the one legitimate use, and it is what makes a scan readable at all;
 * - fully transparent (`ca 0`), unless the same text is drawn visibly in the same place — the
 *   selectable copy Chrome lays over text with a shadow, an outline or a gradient fill;
 * - smaller than 2pt;
 * - off the page;
 * - in a colour within 1.25:1 contrast of what lies beneath it — the topmost shape filled
 *   before it there, else the white page (an image, a gradient or a pattern beneath leaves the
 *   background unknown, and the run is given the benefit of the doubt);
 * - covered by an image or an opaque shape drawn after it.
 *
 * Measured, not certain: a font whose glyphs are drawn as paths, a clip region or a blend mode
 * can still hide text this does not see. It errs on the side of not accusing anyone.
 */

import { indexDrawn, type Box, type Drawn } from "./surroundings.js";
import { countRuledTables, pathRules } from "./tables.js";

export type { Box };

type Matrix = [number, number, number, number, number, number];

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const MIN_SIZE = 2;
const MIN_CONTRAST = 1.25;

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

/** Relative luminance of a "#rrggbb" colour (WCAG 2). */
function luminance(hex: string) {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string) {
  const [la, lb] = [luminance(a), luminance(b)];
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * `fill` and `stroke` are "#rrggbb", or "" when the colour is not a flat one: a pattern, a
 * gradient. `alpha` and `strokeAlpha` are `ca` and `CA`. `softMask`: a soft mask is in force, so
 * what is painted may show through anywhere, or nowhere. `lineWidth` is the pen (`w`), in user
 * space.
 *
 * The text state — font size (`Tf`), horizontal scaling (`Tz`, as a factor), leading (`TL`) and
 * render mode (`Tr`) — is part of the graphics state, so `q`/`Q` save and restore it: an
 * invisible or 1pt line inside `q … Q` must not make every line after it hidden too.
 */
type GraphicsState = {
  ctm: Matrix;
  fill: string;
  stroke: string;
  alpha: number;
  strokeAlpha: number;
  softMask: boolean;
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
} & GraphicsState;

/**
 * `images`: where each image was drawn, in page points. `marks`: small filled shapes — list
 * markers Chrome draws as paths rather than glyphs — in page points too. `tables`: ruled tables
 * drawn on the page (`countRuledTables`). `invisibleChars`: of `textChars`, those drawn in an
 * invisible render mode, as a scan's OCR layer is.
 */
export type PageVisibility = {
  textChars: number;
  invisibleChars: number;
  hidden: string[];
  images: Box[];
  marks: Box[];
  tables: number;
};

/** Shapes no wider or taller than this, in points, may be list markers; this many are kept. */
const MARK_SIZE = 12;
const MAX_MARKS = 2_000;

/** Glyphs a soft mask is built from that are matched against what is painted through it; past
 * this many pairs, the rest are taken as painted visibly. */
const MAX_MASK_PAIRS = 100_000;
/** Visible glyphs a transparent run is compared with, across a page, before the rest are not. */
const MAX_PIECE_CHECKS = 2_000_000;

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
 * pdf.js paints an image that carries its own mask — a soft mask (`/SMask`) or a colour-key or
 * stencil `/Mask` alike — as `save`, `setGState [["SMask", false]]`, the image, `restore`: the
 * only trace of the mask it lists, and the same for a mask that hides nothing.
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
 * Which of a page's masked images can actually be seen through: those whose decoded pixels
 * hold an alpha below 255. A colour key that matches no pixel, or a soft mask opaque throughout,
 * leaves the image as solid as one with no mask at all.
 *
 * pdf.js sends an image's pixels apart from the operator list, possibly after it, so this
 * waits for each (`waitMs` at most). An image whose pixels do not arrive, or arrive in a form
 * this cannot read (a bitmap), is taken as see-through: the benefit of the doubt, as before.
 * Pass the result to `measureVisibility`.
 */
export async function seeThroughImages(
  ops: Ops,
  list: OperatorList,
  page: PageObjects,
  waitMs = 2_000,
): Promise<Set<string>> {
  const ids = new Set<string>();
  list.fnArray.forEach((fn, order) => {
    const id = list.argsArray[order]?.[0];
    if (fn === ops.paintImageXObject && typeof id === "string" && ownMask(ops, list, order))
      ids.add(id);
  });
  const seeThrough = new Set<string>();
  await Promise.all(
    [...ids].map(async (id) => {
      const store = id.startsWith("g_") ? page.commonObjs : page.objs;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const image = await Promise.race([
        new Promise<unknown>((resolve) => store.get(id, resolve)),
        new Promise<undefined>((resolve) => (timer = setTimeout(() => resolve(undefined), waitMs))),
      ]).finally(() => clearTimeout(timer));
      const { kind, data } = (image ?? {}) as { kind?: unknown; data?: unknown };
      // pdf.js's ImageKind: 1 grey, 2 RGB — no alpha, opaque — and 3 RGBA.
      if (kind === 1 || kind === 2) return;
      if (kind === 3 && data instanceof Uint8ClampedArray) {
        for (let at = 3; at < data.length; at += 4) if (data[at]! < 255) return seeThrough.add(id);
        return;
      }
      seeThrough.add(id);
    }),
  );
  return seeThrough;
}

/**
 * `seeThrough`: the masked images (`seeThroughImages`) whose pixels let what is under them
 * show. Without it, every image with a mask of its own is taken as see-through.
 */
export function measureVisibility(
  ops: Ops,
  list: OperatorList,
  pageBox: Box,
  seeThrough?: ReadonlySet<string>,
): PageVisibility {
  const stack: GraphicsState[] = [];
  let state: GraphicsState = {
    ctm: IDENTITY,
    fill: "#000000",
    stroke: "#000000",
    alpha: 1,
    strokeAlpha: 1,
    softMask: false,
    lineWidth: 1,
    fontSize: 0,
    // Horizontal scaling (`Tz`), as a factor: it narrows glyphs and their advance alike.
    hScale: 1,
    leading: 0,
    mode: 0,
  };
  let textMatrix: Matrix = IDENTITY;
  let lineMatrix: Matrix = IDENTITY;
  // The last path built, in page space: what a shading (`sh`) fills is the clip it sets.
  let lastPath: Box | null = null;
  // Inside a soft mask's own content: pdf.js lists what the mask is made of among the page's
  // operators, but none of it is painted.
  let maskDepth = 0;

  const drawn: Drawn[] = [];
  const runs: Run[] = [];
  const marks: Box[] = [];
  // Where glyphs were drawn as a soft mask — text painted with a gradient — and where visible
  // text was drawn: a transparent copy of either is the selectable layer of a text effect.
  const drawnGlyphs = new Set<string>();
  // The glyphs the soft mask being built or in force is made of. They show only where what is
  // painted through the mask stands out from what lies under it: a white rectangle painted
  // through a mask of the text on a white page shows nothing, and is no visible copy of it.
  let maskGlyphs: Array<{ text: string; center: [number, number] }> = [];
  const throughMask: Array<{
    text: string;
    center: [number, number];
    fill: string;
    order: number;
  }> = [];
  /** Something painted, unless it only builds a soft mask. */
  const paint = (item: Omit<Drawn, "alpha">, masked = state.softMask) => {
    if (maskDepth) return;
    if (state.softMask)
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
    // Through a mask it may show anywhere or nowhere: it covers nothing for certain, and what
    // lies on it has no known background.
    drawn.push(masked ? { ...item, fill: "", alpha: 0 } : { ...item, alpha: state.alpha });
  };
  /** An image's own mask lets what is under it show — unless its pixels say it hides nothing. */
  const masksItself = (fn: number, order: number) => {
    if (!ownMask(ops, list, order)) return false;
    const id = list.argsArray[order]?.[0];
    if (!seeThrough || fn !== ops.paintImageXObject || typeof id !== "string") return true;
    return seeThrough.has(id);
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
    for (const glyph of glyphs) {
      if (typeof glyph === "number") advance -= (glyph / 1000) * fontSize;
      else if (glyph && typeof glyph === "object") {
        const { unicode, width } = glyph as { unicode?: string; width?: number };
        text += unicode ?? "";
        advance += ((width ?? 0) / 1000) * fontSize;
      }
    }
    advance *= hScale;
    const device = multiply(state.ctm, textMatrix);
    // A glyph prints as small as its narrower side: `1 Tz`, or a matrix that squashes the text
    // sideways, leaves 10pt text a hairline wide, as unreadable as 0.1pt text.
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
      origin: apply(device, 0, 0),
      // No font size set is no size known (NaN, never tiny); a mirrored font is its own size, and
      // a zero scale — `0 Tz` — leaves no size at all.
      size: fontSize ? Math.abs(fontSize) * scale : Number.NaN,
      box,
      center,
      order,
    });
  };

  list.fnArray.forEach((fn, order) => {
    const args = list.argsArray[order] ?? [];
    if (fn === ops.save) stack.push({ ...state });
    else if (fn === ops.restore) state = stack.pop() ?? state;
    else if (fn === ops.transform)
      state = {
        ...state,
        ctm: multiply(state.ctm, Array.from(args as ArrayLike<number>) as Matrix),
      };
    // A form XObject is drawn inside its own `q … Q`, through its own matrix: a colour it sets
    // must not leak into the page's text after it, and its content is placed where it prints.
    else if (fn === ops.paintFormXObjectBegin) {
      stack.push({ ...state });
      const matrix = args[0];
      if (Array.isArray(matrix) || ArrayBuffer.isView(matrix))
        state = {
          ...state,
          ctm: multiply(state.ctm, Array.from(matrix as ArrayLike<number>) as Matrix),
        };
    } else if (fn === ops.paintFormXObjectEnd) state = stack.pop() ?? state;
    else if ((fn === ops.beginGroup || fn === ops.endGroup) && isSoftMaskGroup(args[0])) {
      // A new mask's glyphs replace the last one's.
      if (fn === ops.beginGroup && !maskDepth) maskGlyphs = [];
      maskDepth = Math.max(0, maskDepth + (fn === ops.beginGroup ? 1 : -1));
    } else if (fn === ops.setFillRGBColor && typeof args[0] === "string")
      state = { ...state, fill: args[0] };
    else if (fn === ops.setStrokeRGBColor && typeof args[0] === "string")
      state = { ...state, stroke: args[0] };
    // pdf.js turns every flat colour into RGB; what is left for `scn` is a pattern.
    else if (fn === ops.setFillColorN) state = { ...state, fill: "" };
    else if (fn === ops.setStrokeColorN) state = { ...state, stroke: "" };
    else if (fn === ops.setGState && Array.isArray(args[0]))
      for (const entry of args[0] as unknown[]) {
        if (!Array.isArray(entry)) continue;
        const [key, value] = entry as [unknown, unknown];
        if (key === "ca" && typeof value === "number") state = { ...state, alpha: value };
        else if (key === "CA" && typeof value === "number")
          state = { ...state, strokeAlpha: value };
        else if (key === "SMask") state = { ...state, softMask: value === true };
        else if (key === "LW" && typeof value === "number") state = { ...state, lineWidth: value };
      }
    else if (fn === ops.setLineWidth) state = { ...state, lineWidth: Number(args[0]) || 0 };
    else if (fn === ops.beginText) textMatrix = lineMatrix = IDENTITY;
    else if (fn === ops.setFont) state = { ...state, fontSize: Number(args[1]) || 0 };
    else if (fn === ops.setHScale)
      state = {
        ...state,
        hScale: Number.isFinite(Number(args[0])) ? Number(args[0]) / 100 : 1,
      };
    else if (fn === ops.setTextRenderingMode) state = { ...state, mode: Number(args[0]) || 0 };
    else if (fn === ops.setLeading) state = { ...state, leading: Number(args[0]) || 0 };
    else if (fn === ops.moveText) moveText(Number(args[0]), Number(args[1]));
    else if (fn === ops.setLeadingMoveText) {
      state = { ...state, leading: -Number(args[1]) };
      moveText(Number(args[0]), Number(args[1]));
    } else if (fn === ops.setTextMatrix) {
      // pdf.js passes the matrix as a typed array, wrapped or not depending on the version; a
      // plain-array check read it as NaN and silently hid nothing.
      const inner = args[0];
      const matrix = Array.isArray(inner) || ArrayBuffer.isView(inner) ? inner : args;
      textMatrix = lineMatrix = Array.from(matrix as ArrayLike<number>).map(Number) as Matrix;
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
      if (!maskDepth && (filled || stroked) && (ArrayBuffer.isView(data) || Array.isArray(data))) {
        const [a, b, c, d] = state.ctm;
        pathRules(
          data as ArrayLike<number>,
          (x, y) => apply(state.ctm, x, y),
          filled,
          stroked ? state.lineWidth * Math.sqrt(Math.abs(a * d - b * c)) : undefined,
          rules,
        );
      }
      const bounds = args[2];
      if (Array.isArray(bounds) || ArrayBuffer.isView(bounds)) {
        const [x0, y0, x1, y1] = Array.from(bounds as ArrayLike<number>);
        lastPath = boxThrough(state.ctm, [x0, y0, x1, y1]);
        if (isFill.has(args[0] as number)) {
          paint({ box: lastPath, order, kind: "shape", fill: state.fill });
          const [mx0, my0, mx1, my1] = lastPath;
          if (
            !maskDepth &&
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
    // A one-pixel stencil mask (`BI /IM true`) paints its unit square in the fill colour: a
    // rectangle like any other, under text or over it.
    else if (fn === ops.paintSolidColorImageMask)
      paint({ box: boxThrough(state.ctm, [0, 0, 1, 1]), order, kind: "shape", fill: state.fill });
    else if (isImage.has(fn))
      paint(
        { box: boxThrough(state.ctm, [0, 0, 1, 1]), order, kind: "image", fill: "" },
        state.softMask || masksItself(fn, order),
      );
  });

  const around = indexDrawn(
    drawn,
    [...runs.map((run) => run.center), ...throughMask.map((glyph) => glyph.center)],
    pageBox,
  );
  for (const { text, center, fill, order } of throughMask) {
    const top = around(center, order).top;
    const background = top ? top.fill : "#ffffff";
    if (fill === "" || background === "" || contrast(fill, background) >= MIN_CONTRAST)
      drawnGlyphs.add(cell(text, center));
  }
  // What the render mode paints the glyphs with: their outline in modes 1 and 5, outline and
  // fill in 2 and 6 (seen if either is), else their fill. Outlined text is judged by its stroke:
  // a white-filled heading outlined in black is plainly visible.
  const paintsOf = (run: Run) => [
    ...(run.mode % 4 === 1 ? [] : [{ colour: run.fill, alpha: run.alpha }]),
    ...(run.mode % 4 === 1 || run.mode % 4 === 2
      ? [{ colour: run.stroke, alpha: run.strokeAlpha }]
      : []),
  ];
  const transparentRun = (run: Run) => paintsOf(run).every(({ alpha }) => alpha === 0);
  // Visible runs by the point their baseline is on, in order along it: Chrome draws an outline
  // a glyph at a time and its transparent copy in pieces ("PRIY", "A", " NAIR"), in fonts whose
  // widths differ, so a piece is matched by the glyphs that start within it.
  const lines = new Map<number, Run[]>();
  for (const run of runs)
    if (run.mode % 4 !== 3 && !transparentRun(run)) {
      drawnGlyphs.add(cell(run.text, run.center));
      const key = Math.round(run.origin[1]);
      if (lines.has(key)) lines.get(key)!.push(run);
      else lines.set(key, [run]);
    }
  for (const line of lines.values()) line.sort((a, b) => a.origin[0] - b.origin[0]);
  let checks = 0;
  const copied = (run: Run) => {
    const [x, y] = run.origin;
    // Widths differ a little between the two fonts: the glyphs are taken in order from where
    // the piece starts until they spell as many characters as it has.
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

  const hidden: string[] = [];
  let previous: Run | undefined;
  let textChars = 0;
  let invisibleChars = 0;
  for (const run of runs) {
    const chars = run.text.trim().length;
    textChars += chars;
    const { top, overImage, covered } = around(run.center, run.order);

    const unseen = run.mode === 3 || run.mode === 7;
    if (unseen) invisibleChars += chars;
    const invisible = unseen && !overImage;
    const paints = paintsOf(run);
    // Fully transparent, unless the same text is drawn where it lies — as glyphs, or as the mask
    // a gradient is painted through: Chrome lays such a copy over text with a shadow, an outline
    // or `background-clip: text`, for selection. It hides nothing.
    const transparent =
      transparentRun(run) &&
      ![-1, 0, 1].some((dx) =>
        [-1, 0, 1].some((dy) => drawnGlyphs.has(cell(run.text, run.center, dx, dy))),
      ) &&
      !copied(run);
    const tiny = run.size < MIN_SIZE;
    const offPage =
      run.box[2] < pageBox[0] ||
      run.box[0] > pageBox[2] ||
      run.box[3] < pageBox[1] ||
      run.box[1] > pageBox[3];
    // An image, a gradient or a pattern beneath leaves the background unknown, and text in a
    // pattern has no one colour: either way the run is given the benefit of the doubt.
    const background = top ? top.fill : "#ffffff";
    const blended =
      background !== "" &&
      paints.every(({ colour }) => colour !== "" && contrast(colour, background) < MIN_CONTRAST);

    if (!(invisible || transparent || tiny || offPage || blended || covered)) continue;
    // Runs one after another on a line are one piece of text: Chrome draws a glyph at a time, and
    // its hidden text read back "K u b e r n e t e s". A gap of a space's width is a space.
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
    tables: countRuledTables(
      rules,
      runs.map((run) => run.center),
    ),
  };
}
