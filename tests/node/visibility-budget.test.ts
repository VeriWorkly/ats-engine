import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it, vi } from "vitest";

import { measureVisibility } from "../../src/node/hidden.js";
import { extractResume } from "../../src/node/index.js";
import { indexDrawn, MAX_POINT_CHECKS, type Drawn } from "../../src/node/surroundings.js";
import { buildPdf } from "../fixtures/buildPdf.js";

/**
 * A crowded page cannot hold the visibility replay: the work is bounded by a count of point
 * checks, not by time, so these tests assert on the count and on the outcome. The replay's
 * budget is lowered here so the limit is reached in milliseconds on any machine.
 */

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
