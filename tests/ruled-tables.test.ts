import { OPS } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";

import { AtsScoringService, DEFAULT_POLICY } from "../src/index.js";
import { extractResume } from "../src/node/extract.js";
import { measureVisibility } from "../src/node/hidden.js";
import { countRuledTables, type Box } from "../src/node/tables.js";
import {
  buildPdf,
  buildPdfPages,
  chromePage,
  chromeRect,
  chromeTable,
  chromeText,
  ruledTable,
  text,
} from "./fixtures/buildPdf.js";
import { expectFast } from "./fixtures/timing.js";

/**
 * Ruled tables read from the page's own drawing, as well as pdf-parse's: a browser prints a CSS
 * border as a thin filled rectangle (`re f`), not a stroked line, and pdf-parse's `getTable`
 * looks for stroked rules only, so a resume laid out in a bordered HTML table reported "No ruled
 * tables were found". A table here is horizontal and vertical rules — stroked lines, or filled
 * rectangles at most 1.5pt thick — closing at least a 2×2 grid of cells with text in them.
 * Every resume here is an invented person.
 */

const tables = async (pdf: Buffer) => (await extractResume(pdf, "pdf")).layout?.tableCount;

/** Lines of body text down the page, in Chrome's CSS pixels. */
const body = (top: number, lines: string[], left = 80) =>
  lines.map((line, index) => chromeText(left, top + index * 20, line));

const PROSE = [
  "Led the rebuild of the billing service for 40,000 customers",
  "Cut the monthly close from nine days to four with a ledger rewrite",
  "Mentored four engineers, two of them promoted within a year",
];

describe("tables drawn by a browser", () => {
  it("finds a bordered table with collapsed borders: every edge a filled 0.75pt rectangle", async () => {
    expect(await tables(buildPdf(chromePage(chromeTable(3, 2))))).toBe(1);
  }, 30_000);

  it("finds one with separate borders: each cell boxed inside the table's own border", async () => {
    expect(await tables(buildPdf(chromePage(chromeTable(2, 3, { collapse: false }))))).toBe(1);
  }, 30_000);

  it("finds one whose every border is a single frame: a rectangle with the inner one cut out", async () => {
    const page = chromePage(chromeTable(2, 3, { collapse: false, frames: true }));
    expect(await tables(buildPdf(page))).toBe(1);
  }, 30_000);

  it("does not take a single framed box for a table", async () => {
    const page = chromePage(chromeTable(1, 1, { frames: true }), ...body(100, PROSE));
    expect(await tables(buildPdf(page))).toBe(0);
  }, 30_000);

  it("finds the smallest grid there is, two cells by two", async () => {
    expect(await tables(buildPdf(chromePage(chromeTable(2, 2))))).toBe(1);
  }, 30_000);

  it("counts two tables on a page as two", async () => {
    const page = chromePage(chromeTable(2, 2, { top: 120 }), chromeTable(3, 3, { top: 500 }));
    expect(await tables(buildPdf(page))).toBe(2);
  }, 30_000);

  it("counts the tables of each measured page", async () => {
    const page = chromePage(chromeTable(2, 2));
    expect(await tables(buildPdfPages([page, page]))).toBe(2);
  }, 30_000);

  it("leaves out a grid whose cells hold no text", async () => {
    const empty = chromeTable(3, 3).replace(/BT .*? ET/g, "");
    expect(await tables(buildPdf(chromePage(empty, ...body(100, PROSE))))).toBe(0);
  }, 30_000);
});

describe("classic stroked tables", () => {
  it("still finds a grid of stroked lines", async () => {
    expect(await tables(buildPdf(ruledTable(4, 3)))).toBe(1);
  }, 30_000);

  it("finds one whose cells are each a stroked rectangle", async () => {
    const cells: string[] = ["0.5 w"];
    for (let row = 0; row < 3; row += 1)
      for (let col = 0; col < 2; col += 1) {
        const [x, y] = [60 + col * 200, 500 - row * 30];
        cells.push(`${x} ${y} 200 30 re S`, text(x + 8, y + 10, `Cell ${row}${col}`));
      }
    expect(await tables(buildPdf(cells.join("\n")))).toBe(1);
  }, 30_000);
});

describe("rules that are not tables", () => {
  it("section divider lines: one horizontal rule under each heading", async () => {
    const ops = ["Experience", "Education", "Skills", "Projects"].flatMap((heading, index) => {
      const top = 80 + index * 160;
      return [
        chromeText(80, top, heading),
        chromeRect(80, top + 6, 650, 1),
        ...body(top + 30, PROSE),
      ];
    });
    expect(await tables(buildPdf(chromePage(...ops)))).toBe(0);
  }, 30_000);

  it("underlined links and words", async () => {
    const ops = PROSE.flatMap((line, index) => [
      chromeText(80, 100 + index * 24, line),
      chromeRect(80, 103 + index * 24, 120, 1),
      chromeRect(300, 103 + index * 24, 60, 1),
    ]);
    expect(await tables(buildPdf(chromePage(...ops)))).toBe(0);
  }, 30_000);

  it("a border around the whole page, with dividers running from edge to edge", async () => {
    const ops = [
      chromeRect(30, 30, 756, 1),
      chromeRect(30, 1025, 756, 1),
      chromeRect(30, 30, 1, 996),
      chromeRect(785, 30, 1, 996),
      ...body(80, ["Dana Whitfield", "dana.whitfield@example.com"]),
      chromeRect(30, 130, 756, 1),
      ...body(170, PROSE),
      chromeRect(30, 260, 756, 1),
      ...body(300, PROSE),
    ];
    expect(await tables(buildPdf(chromePage(...ops)))).toBe(0);
  }, 30_000);

  it("a bordered page split into a header and two columns", async () => {
    // One row of two cells under a full-width header: a layout, not a 2×2 grid.
    const ops = [
      chromeRect(30, 30, 756, 1),
      chromeRect(30, 1025, 756, 1),
      chromeRect(30, 30, 1, 996),
      chromeRect(785, 30, 1, 996),
      chromeRect(30, 150, 756, 1),
      chromeRect(260, 150, 1, 876),
      ...body(80, ["Dana Whitfield"]),
      ...body(190, ["Python", "SQL", "Kubernetes"], 50),
      ...body(190, PROSE, 280),
    ];
    expect(await tables(buildPdf(chromePage(...ops)))).toBe(0);
  }, 30_000);

  it("a single box around the contact details", async () => {
    const ops = [
      "0.75 w 50 640 300 90 re S",
      text(60, 705, "Dana Whitfield"),
      text(60, 685, "dana.whitfield@example.com"),
      text(60, 665, "+1 503 555 0142"),
      ...PROSE.map((line, index) => text(60, 600 - index * 16, line)),
    ];
    expect(await tables(buildPdf(ops.join("\n")))).toBe(0);
  }, 30_000);

  it("skill-bar graphics: an outlined track and a filled bar beside each skill", async () => {
    const ops = ["Python", "SQL", "Go", "Terraform", "Kubernetes"].flatMap((skill, index) => {
      const top = 120 + index * 28;
      return [
        chromeText(80, top, skill),
        // The track's 1px outline, then the level painted inside it.
        chromeRect(260, top - 10, 200, 1),
        chromeRect(260, top - 1, 200, 1),
        chromeRect(260, top - 10, 1, 10),
        chromeRect(459, top - 10, 1, 10),
        chromeRect(261, top - 9, 40 + index * 30, 8),
      ];
    });
    expect(await tables(buildPdf(chromePage(...ops, ...body(320, PROSE))))).toBe(0);
  }, 30_000);

  it("coloured header bands and a sidebar background", async () => {
    const ops = [
      "0.1 0.2 0.4 rg",
      chromeRect(0, 0, 816, 120),
      "0.93 0.94 0.96 rg",
      chromeRect(0, 120, 240, 936),
      "0.1 0.2 0.4 rg",
      chromeRect(260, 180, 520, 3),
      "1 1 1 rg",
      chromeText(80, 60, "Dana Whitfield"),
      "0 0 0 rg",
      ...body(170, ["Python", "SQL", "Go"], 40),
      ...body(220, PROSE, 280),
    ];
    expect(await tables(buildPdf(chromePage(...ops)))).toBe(0);
  }, 30_000);
});

describe("a resume laid out in a bordered table", () => {
  it("fails the tables rule, which it passed while only stroked rules were looked for", async () => {
    // Each section a row: its heading in the left cell, its content in the right.
    const cell = (row: number, heading: string, lines: string[]) => {
      const top = 140 + row * 110;
      return [
        chromeText(88, top + 24, heading),
        ...lines.map((line, index) => chromeText(248, top + 24 + index * 20, line)),
      ];
    };
    const page = chromePage(
      chromeText(80, 60, "Dana Whitfield"),
      chromeText(80, 84, "dana.whitfield@example.com | +1 503 555 0142 | Portland, OR"),
      ...[0, 1, 2, 3].flatMap((row) => [
        chromeRect(80, 140 + row * 110, 656, 1),
        chromeRect(80, 140 + row * 110, 1, 111),
        chromeRect(240, 140 + row * 110, 1, 111),
        chromeRect(735, 140 + row * 110, 1, 111),
      ]),
      chromeRect(80, 580, 656, 1),
      ...cell(0, "Summary", ["Backend engineer, eight years in payments"]),
      ...cell(1, "Experience", ["Senior Engineer, Fabrikam Payments  2019 - Present", ...PROSE]),
      ...cell(2, "Education", ["B.S. Computer Science, Portland State University, 2016"]),
      ...cell(3, "Skills", ["Go, PostgreSQL, Kafka, Terraform, Kubernetes"]),
    );
    const { text: extracted, layout } = await extractResume(buildPdf(page), "pdf");
    expect(layout?.tableCount).toBe(1);

    const report = AtsScoringService.check(extracted, DEFAULT_POLICY, {
      layout,
      now: new Date("2026-10-01T00:00:00Z"),
    });
    const rule = report.rules.find((result) => result.id === "ats-v2.format.tables");
    expect(rule?.passed).toBe(false);
    expect(rule?.evidence).toBe("1 ruled table was found.");
  }, 30_000);
});

describe("cost on a crowded page", () => {
  const ops = OPS as unknown as Record<string, number>;
  const PAGE: Box = [0, 0, 612, 792];

  /**
   * 20,000 shapes: a 50×50 table whose every cell edge is its own filled hairline (10,000), with
   * a word in each cell, and 10,000 more hairlines scattered across it.
   */
  function crowdedTablePage() {
    const fnArray: number[] = [];
    const argsArray: unknown[][] = [];
    const rect = (x: number, y: number, width: number, height: number) => {
      fnArray.push(ops.constructPath);
      argsArray.push([
        ops.fill,
        [
          new Float32Array([
            0,
            x,
            y,
            1,
            x + width,
            y,
            1,
            x + width,
            y + height,
            1,
            x,
            y + height,
            3,
          ]),
        ],
        [x, y, x + width, y + height],
      ]);
    };
    const [left, bottom, size] = [6, 6, 12];
    for (let row = 0; row < 50; row += 1)
      for (let col = 0; col < 50; col += 1) {
        const [x, y] = [left + col * size, bottom + row * size];
        rect(x, y, size, 0.5);
        rect(x, y + size, size, 0.5);
        rect(x, y, 0.5, size);
        rect(x + size, y, 0.5, size);
        fnArray.push(ops.setFont, ops.setTextMatrix, ops.showText);
        argsArray.push(["F1", 4], [[1, 0, 0, 1, x + 2, y + 4]], [[{ unicode: "x", width: 500 }]]);
      }
    for (let i = 0; i < 10_000; i += 1) {
      const [x, y] = [(i * 37) % 600, (i * 53) % 780];
      if (i % 2) rect(x, y, 40, 0.5);
      else rect(x, y, 0.5, 40);
    }
    return { fnArray, argsArray };
  }

  it("replays 20,000 shapes, half of them a table, and finds the table", () => {
    const page = crowdedTablePage();
    // The replay alone takes ~0.5s on a desktop and ~3s on a GitHub runner (see the crowded-page
    // test in audit-2026-10); finding the table adds a few milliseconds.
    const seen = expectFast(() => measureVisibility(ops, page, PAGE), 8_000);
    expect(seen.tables).toBeGreaterThanOrEqual(1);
  }, 30_000);

  it("stays linear when every rule crosses every point", () => {
    // 20,000 rules all through the same spot and 20,000 words on it: without the rule and check
    // budgets, 400 million comparisons.
    const rules: Box[] = Array.from({ length: 20_000 }, (_, i) =>
      i % 2
        ? [0, 300 + (i % 400) / 100, 600, 300.5 + (i % 400) / 100]
        : [i % 600, 0, (i % 600) + 0.5, 792],
    );
    const points = Array.from({ length: 20_000 }, (_, i): [number, number] => [(i * 7) % 600, 302]);
    expectFast(() => countRuledTables(rules, points), 250);
  });
});
