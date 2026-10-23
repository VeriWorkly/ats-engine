import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";

import { measureVisibility } from "../../src/node/hidden.js";
import { extractResume } from "../../src/node/index.js";
import { indexDrawn, MAX_POINT_CHECKS, type Drawn } from "../../src/node/surroundings.js";
import { buildPdf } from "../fixtures/buildPdf.js";

/** A crowded page cannot hold the visibility replay: work is bounded by a count of point checks, asserted here with a lowered budget. */

const TEST_BUDGET = 100_000;

vi.mock("../../src/node/surroundings.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/node/surroundings.js")>();
  return {
    ...actual,
    indexDrawn: (...args: Parameters<typeof actual.indexDrawn>) =>
      actual.indexDrawn(args[0], args[1], args[2], args[3] ?? TEST_BUDGET),
  };
});

/** `count` 1pt squares, all in one cell of the index. */
function packedShapes(count: number): Drawn[] {
  return Array.from({ length: count }, (_, i) => ({
    box: [100 + (i % 50), 100, 101 + (i % 50), 101] as [number, number, number, number],
    order: i,
    kind: "shape" as const,
    fill: "#ffffff",
    alpha: 1,
  }));
}

describe("a crowded page cannot hold the visibility replay", () => {
  it("stops after its budget of point checks, however many shapes and runs there are", () => {
    const shapes = packedShapes(2_000);
    const points = shapes.map((_, i): [number, number] => [100.5 + (i % 50), 100.5]);
    const around = indexDrawn(shapes, points, [0, 0, 612, 792], TEST_BUDGET);
    let queried = 0;
    expect(() => {
      for (const point of points) {
        around(point, shapes.length + queried);
        queried += 1;
      }
    }).toThrow();
    // Each query checks the cell's 2 000 shapes: the budget is spent after 50 of the 2 000 runs.
    expect(queried * shapes.length).toBeLessThanOrEqual(TEST_BUDGET);
    expect((queried + 1) * shapes.length).toBeGreaterThan(TEST_BUDGET);
  });

  it("keeps the default budget below a full scan of a page the file's author packs", () => {
    // 40 000 shapes and runs in one cell meet pairwise: 1.6 billion checks, about a minute.
    expect(MAX_POINT_CHECKS).toBeLessThan(40_000 * 40_000);
    expect(MAX_POINT_CHECKS).toBeGreaterThanOrEqual(20_000_000);
  });

  it("gives up, as unmeasured, instead of scanning quadratically", () => {
    const ops = OPS as unknown as Record<string, number>;
    const fnArray: number[] = [];
    const argsArray: unknown[][] = [];
    for (let i = 0; i < 2_000; i += 1) {
      fnArray.push(ops.constructPath);
      argsArray.push([ops.fill, [], new Float32Array([100 + (i % 50), 100, 101 + (i % 50), 101])]);
    }
    for (let i = 0; i < 2_000; i += 1) {
      fnArray.push(ops.beginText, ops.setFont, ops.setTextMatrix, ops.showText);
      argsArray.push(
        [],
        ["F1", 10],
        [[1, 0, 0, 1, 100 + (i % 50), 120]],
        [[{ unicode: "a", width: 500 }]],
      );
    }
    expect(() => measureVisibility(ops, { fnArray, argsArray }, [0, 0, 612, 792])).toThrow(
      "Too much drawn in one place to measure.",
    );
  });

  it("reports such a page's hidden text as not measured", async () => {
    const shapes: string[] = [];
    const runs: string[] = [];
    for (let i = 0; i < 2_000; i += 1) {
      shapes.push(`${100 + (i % 50)} 100 1 1 re f`);
      runs.push(`BT /F1 10 Tf ${100 + (i % 50)} 120 Td (a) Tj ET`);
    }
    const { layout } = await extractResume(buildPdf([...shapes, ...runs].join("\n")), "pdf");
    expect(layout?.hiddenTextChars).toBeUndefined();
  });
});

describe("a page's filled paths are split into boxes within a budget", () => {
  const ops = OPS as unknown as Record<string, number>;
  type Rect = [number, number, number, number];

  /** An operator list: `fill(rects)` adds a path of upright rectangles, `text` a run of one glyph. */
  function page() {
    const fnArray: number[] = [];
    const argsArray: unknown[][] = [];
    return {
      list: { fnArray, argsArray },
      colour(hex: string) {
        fnArray.push(ops.setFillRGBColor);
        argsArray.push([hex]);
      },
      fill(rects: Rect[], op = ops.eoFill) {
        const data = rects.flatMap(([x, y, w, h]) => [
          ...[0, x, y, 1, x + w, y, 1, x + w, y + h, 1, x, y + h, 3],
        ]);
        const xs = rects.flatMap(([x, , w]) => [x, x + w]);
        const ys = rects.flatMap(([, y, , h]) => [y, y + h]);
        const bounds = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        fnArray.push(ops.constructPath);
        argsArray.push([op, [new Float32Array(data)], new Float32Array(bounds)]);
      },
      text(x: number, y: number, unicode: string) {
        fnArray.push(ops.beginText, ops.setFont, ops.setTextMatrix, ops.showText);
        argsArray.push(
          [],
          ["F1", 10],
          [[1, 0, 0, 1, x, y]],
          [[{ unicode, width: 500 * unicode.length }]],
        );
      },
    };
  }
  /** Four bars across and four down, 60pt square, filled even-odd: split, 40 boxes. */
  const lattice = (x: number, y: number): Rect[] => [
    ...[5, 20, 35, 50].map((at): Rect => [x + at, y, 2, 60]),
    ...[5, 20, 35, 50].map((at): Rect => [x, y + at, 60, 2]),
  ];
  /** A 1pt black frame around 300,600 to 500,630, and black text in it. */
  const framedText = (on: ReturnType<typeof page>) => {
    on.colour("#000000");
    on.fill([
      [300, 600, 200, 30],
      [301, 601, 198, 28],
    ]);
    on.text(310, 610, "Kubernetes");
  };

  it("reads a frame past the page's cap of boxes whole, and stays within its point checks", () => {
    const on = page();
    on.colour("#ffffff");
    // 350 lattices in one place split whole are 14,000 boxes: 20 runs on them would each check
    // them all, past the budget of 100,000 point checks.
    for (let i = 0; i < 350; i += 1) on.fill(lattice(100, 100));
    on.colour("#000000");
    for (let i = 0; i < 20; i += 1) on.text(102 + i, 130, "a");
    framedText(on);
    const seen = measureVisibility(ops, on.list, [0, 0, 612, 792]);
    // Past the cap the frame is its bounding box, solid black: the text in it is on black.
    expect(seen.hidden).toEqual(["Kubernetes"]);
  });

  it("splits a frame before the cap is spent", () => {
    const on = page();
    on.colour("#ffffff");
    for (let i = 0; i < 10; i += 1) on.fill(lattice(100, 100));
    framedText(on);
    expect(measureVisibility(ops, on.list, [0, 0, 612, 792]).hidden).toEqual([]);
  });
});
