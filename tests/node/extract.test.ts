import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  detectResumeFormat,
  extractResume,
  MAX_EXTRACTED_CHARS,
  normalizeExtractedText,
} from "../../src/node/extract.js";
import { findGutter } from "../../src/node/layout.js";
import { optional } from "../../src/node/peer.js";
import { buildDocx } from "../fixtures/buildDocx.js";
import {
  buildPdf,
  LEFT_COLUMN,
  RIGHT_COLUMN,
  ruledTable,
  text,
  unicodeFont,
} from "../fixtures/buildPdf.js";

/** The real PDF parser on generated PDFs, end to end rather than against a mock. */
describe("PDF layout detection", () => {
  const extract = (ops: string) => extractResume(buildPdf(ops), "pdf");

  it("reads a single-column resume as one linear stream", async () => {
    const ops = [...LEFT_COLUMN, ...RIGHT_COLUMN]
      .map((line: string, index: number) => text(45, 740 - index * 30, line))
      .join("\n");

    const { layout } = await extract(ops);
    expect(layout?.columnRatio).toBe(0);
    expect(layout?.tableCount).toBe(0);
  }, 60_000);

  it("flags a two-column layout whose columns share baselines, and reads it a column at a time", async () => {
    // Both columns share baselines: the text is read a column at a time, but the layout is still
    // flagged because an ATS reading line by line interleaves it.
    const ops = LEFT_COLUMN.flatMap((line: string, index: number) => [
      text(45, 720 - index * 26, line),
      text(340, 720 - index * 26, RIGHT_COLUMN[index]),
    ]).join("\n");

    const { text: extracted, layout } = await extract(ops);

    // Two balanced columns put half the page's text on the far side of the gutter.
    expect(layout?.columnRatio).toBeGreaterThanOrEqual(0.4);
    const lines = extracted.split("\n");
    expect(lines.slice(0, LEFT_COLUMN.length)).toEqual(LEFT_COLUMN);
    expect(lines.slice(LEFT_COLUMN.length)).toEqual(RIGHT_COLUMN);
  }, 60_000);

  // The content stream emits the whole left column before the right: the text is linear, only the
  // page geometry shows two columns.
  it("flags a two-column layout even when the text still extracts in reading order", async () => {
    const ops = [
      ...LEFT_COLUMN.map((line: string, index: number) => text(45, 720 - index * 26, line)),
      ...RIGHT_COLUMN.map((line: string, index: number) => text(340, 720 - index * 26, line)),
    ].join("\n");

    const { text: extracted, layout } = await extract(ops);

    expect(layout?.columnRatio).toBeGreaterThanOrEqual(0.4);
    // The text alone gives nothing away.
    expect(extracted.split("\n")[0]).not.toContain("Certifications");
  }, 60_000);

  it("does not mistake right-aligned dates for a second column", async () => {
    // Content left, a date pinned right on the same line: a channel, but the dates are tab stops
    // (the page passes the column rule; its band is 0.15).
    const ops = LEFT_COLUMN.flatMap((line: string, index: number) => [
      text(45, 720 - index * 26, line),
      text(470, 720 - index * 26, "2021"),
    ]).join("\n");

    const ratio = (await extract(ops)).layout?.columnRatio;
    expect(ratio).not.toBeNull();
    expect(ratio).toBeLessThan(0.15);
  }, 60_000);

  // Review finding (2026-10-24): a city alone flush right on the employer's line, over the dates
  // on the title's line, was read as a second column, so the roles lost their dates.
  it("reads a city flush right over its dates as tab stops, not a column", async () => {
    const font = unicodeFont();
    const rows: [string, string][] = [];
    for (const [employer, title] of [
      ["Sahyadri Systems Ltd", "व्यवसाय विश्लेषक"],
      ["Ganga Logistics", "डेटा विश्लेषक"],
      ["Himgiri Media Pvt Ltd", "संचालन प्रबंधक"],
      ["Thar Insurance", "परियोजना प्रबंधक"],
    ])
      rows.push([employer, "हैदराबाद"], [title, "2019 – 2022"], ["• रिपोर्टिंग सुधारी", ""]);
    const ops = rows.flatMap(([left, right], index) => {
      const y = 720 - index * 14;
      return right
        ? [font.show(50, y, left), font.show(562 - font.width(right), y, right)]
        : [font.show(50, y, left)];
    });
    const { text: extracted } = await extractResume(font.pages([ops.join("\n")]), "pdf");
    const lines = extracted.split("\n");
    expect(lines[0]).toBe("Sahyadri Systems Ltd\tहैदराबाद");
    expect(lines[1]).toBe("व्यवसाय विश्लेषक\t2019 – 2022");
  }, 60_000);

  it("counts ruled table grids from the page's drawing operators", async () => {
    const { layout } = await extract(ruledTable(4, 3));
    expect(layout?.tableCount).toBeGreaterThanOrEqual(1);
  }, 60_000);

  it("reports the table count even when the document is too short to measure columns", async () => {
    const { layout } = await extract(ruledTable(2, 2));

    // Null, not zero: not measurable is not measured and clean.
    expect(layout?.columnRatio).toBeNull();
    expect(layout?.tableCount).toBeGreaterThanOrEqual(1);
  }, 60_000);
});

describe("resume extraction", () => {
  it("reads a DOCX's paragraphs as lines", async () => {
    const docx = buildDocx(["Jane Doe", "Senior Engineer, Acme & Co", "2019 - 2023"]);
    const { text: extracted, layout } = await extractResume(docx, "docx");

    expect(extracted.split(/\n+/)).toEqual([
      "Jane Doe",
      "Senior Engineer, Acme & Co",
      "2019 - 2023",
    ]);
    // No page geometry, so columns stay unmeasured.
    expect(layout).toEqual({
      columnRatio: null,
      tableCount: 0,
      pageCount: 0,
      imageCount: 0,
      hiddenTextChars: 0,
      hiddenText: "",
      hiddenTextRead: "",
      trackedChanges: 0,
      comments: 0,
    });
  });

  it("decodes plain text as UTF-8 and reports no layout", async () => {
    const result = await extractResume(
      Buffer.from("Zoë Müller\nIngenieurin  \t bei\u0000 Acme"),
      "text",
    );
    // A run of blanks with a tab stays one tab: the parser's column-gap signal.
    expect(result).toEqual({ text: "Zoë Müller\nIngenieurin\tbei Acme" });
  });

  it("leaves the caller's buffer intact, so the same bytes can be read again", async () => {
    // pdf.js detaches the memory it is handed.
    const pdf = buildPdf(ruledTable(4, 3));
    const first = await extractResume(pdf, "pdf");
    const second = await extractResume(pdf, "pdf");
    expect(second).toEqual(first);
    expect(first.layout?.pageCount).toBe(1);
  }, 60_000);

  it("rejects a file that is not the format it claims", async () => {
    await expect(extractResume(Buffer.from("not a zip"), "docx")).rejects.toThrow();
  });

  // A CJK font with a predefined CMap is decoded through pdf.js's CMap files, which were never
  // passed: the text came out empty.
  it("reads text in a CJK font with a predefined CMap", async () => {
    const utf16 = (line: string) =>
      [...line].map((c) => c.charCodeAt(0).toString(16).padStart(4, "0")).join("");
    const lines = ["山田 花子", "ソフトウェアエンジニア", "株式会社サンプル 2019年4月 - 現在"];
    const content = lines
      .map((line, i) => `BT /F2 12 Tf 50 ${750 - i * 20} Td <${utf16(line)}> Tj ET`)
      .join("\n");
    const font =
      "<</Type/Font/Subtype/Type0/BaseFont/HeiseiMin-W3/Encoding/UniJIS-UCS2-H/DescendantFonts[<</Type/Font/Subtype/CIDFontType0/BaseFont/HeiseiMin-W3/CIDSystemInfo<</Registry(Adobe)/Ordering(Japan1)/Supplement 2>>/FontDescriptor<</Type/FontDescriptor/FontName/HeiseiMin-W3/Flags 4/FontBBox[0 -120 1000 880]/ItalicAngle 0/Ascent 880/Descent -120/CapHeight 700/StemV 80>>>>]>>";
    const pdf = buildPdf(content, "/Font<</F2 7 0 R>>", "", [font]);
    const { text: extracted } = await extractResume(pdf, "pdf");
    expect(extracted.replace(/\s/g, "")).toBe(lines.join("").replace(/\s/g, ""));
  });
});

describe("a missing PDF or DOCX reader", () => {
  const root = new URL("../../", import.meta.url);
  const { peerDependencies } = JSON.parse(readFileSync(new URL("package.json", root), "utf8")) as {
    peerDependencies: Record<string, string>;
  };
  // pdfjs-dist is pinned exactly; a bare `pdf-parse` would take the latest major.
  const specs = [
    `pdf-parse@${peerDependencies["pdf-parse"]!.replace(/^\^(\d+).*/, "$1")}`,
    `pdfjs-dist@${peerDependencies["pdfjs-dist"]}`,
    "mammoth",
  ];
  const missing = () =>
    optional(() => Promise.reject(new Error("Cannot find package")), "pdf-parse and pdfjs-dist")
      .then(() => new Error("loaded"))
      .catch((error: Error) => error);

  it("names the package and the command that installs it", async () => {
    const error = await missing();
    expect(error.message).toContain("needs pdf-parse and pdfjs-dist installed");
    expect(error.message).toContain(`npm install ${specs.join(" ")}`);
    expect(error.cause).toBeInstanceOf(Error);
  });

  it("tells a global or npx user how to add them too", async () => {
    const { message } = await missing();
    expect(message).toContain("-g");
    expect(message).toMatch(/npx.*-p/);
  });

  it.each(["README.md", "llms.txt"])("is installed at the same versions %s gives", (name) => {
    const doc = readFileSync(new URL(name, root), "utf8");
    const commands = doc.match(/(?:npm install|npx) [^`\n]*/g) ?? [];
    for (const word of commands.join(" ").split(" "))
      if (/^(?:pdf-parse|pdfjs-dist)\b/.test(word)) expect(specs, name).toContain(word);
    expect(doc).toContain(specs.join(" "));
  });
});

describe("normalizeExtractedText", () => {
  it("collapses blank runs and caps the length", () => {
    expect(normalizeExtractedText("  a\n\n\n\nb  ")).toBe("a\n\nb");
    expect(normalizeExtractedText("x".repeat(MAX_EXTRACTED_CHARS + 10))).toHaveLength(
      MAX_EXTRACTED_CHARS,
    );
  });
});

describe("detectResumeFormat", () => {
  it.each([
    ["cv.PDF", "", "pdf"],
    ["upload", "application/pdf", "pdf"],
    ["cv.docx", "", "docx"],
    ["notes.md", "", "text"],
    ["resume.json", "", "text"],
    ["x", "text/plain", "text"],
    ["cv.doc", "application/msword", null],
    ["cv.pages", "", null],
  ])("%s (%s) is %s", (name, mime, format) => {
    expect(detectResumeFormat(name, mime)).toBe(format);
  });
});

describe("measureColumns", () => {
  const measureColumns = (runs: Parameters<typeof findGutter>[0], width: number) =>
    findGutter(runs, width)?.ratio ?? null;
  const run = (left: number, right: number, mass = 10) => ({ left, right, mass });

  it("reports nothing for a page too sparse to judge", () => {
    expect(measureColumns([run(0, 100)], 600)).toBeNull();
  });

  it("finds a balanced gutter", () => {
    const runs = Array.from({ length: 12 }, (_, index) =>
      index % 2 ? run(320, 560) : run(40, 280),
    );
    expect(measureColumns(runs, 600)).toBeCloseTo(0.5);
  });

  it("finds no gutter when lines span the page", () => {
    const runs = Array.from({ length: 12 }, () => run(40, 560));
    expect(measureColumns(runs, 600)).toBe(0);
  });
});
