import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, describe, expect, it } from "vitest";

import { measureDocx } from "../../src/node/docx.js";
import { extractResume, readResumeFile } from "../../src/node/index.js";
import { buildDocx, buildRichDocx, relationshipsXml } from "../fixtures/buildDocx.js";
import { buildPdf, ownerPasswordTrailer, text } from "../fixtures/buildPdf.js";
import { expectFast } from "../fixtures/timing.js";

/**
 * What a file carries besides its text, measured while it is read: tracked changes and comments
 * left in a Word document, an encrypted PDF that still opens, and the file's own name and size.
 */

const dir = mkdtempSync(join(tmpdir(), "ats-hygiene-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const W = 'w:id="1" w:author="Reviewer" w:date="2026-01-01T00:00:00Z"';
const run = (value: string) => `<w:r><w:t>${value}</w:t></w:r>`;
const NAME = `<w:p>${run("Jane Doe, Senior Engineer at Acme")}</w:p>`;

const COMMENTS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="Reviewer"><w:p>${run("Tighten this")}</w:p></w:comment><w:comment w:id="1" w:author="Reviewer"><w:p>${run("Which year?")}</w:p></w:comment></w:comments>`;

const measure = async (body: string, extra: Array<[string, string]> = []) =>
  (await extractResume(buildRichDocx(NAME + body, extra), "docx")).layout!;

describe("DOCX tracked changes", () => {
  it("counts insertions, deletions, moves and formatting changes", async () => {
    const layout = await measure(
      `<w:p><w:ins ${W}>${run("Led a team of 6")}</w:ins><w:del ${W}><w:r><w:delText>Led a team</w:delText></w:r></w:del></w:p>` +
        `<w:p><w:moveFrom ${W}>${run("Kafka")}</w:moveFrom><w:moveTo ${W}>${run("Kafka")}</w:moveTo></w:p>` +
        `<w:p><w:r><w:rPr><w:b/><w:rPrChange ${W}><w:rPr/></w:rPrChange></w:rPr><w:t>Go</w:t></w:r></w:p>`,
    );
    expect(layout.trackedChanges).toBe(5);
    expect(layout.comments).toBe(0);
  });

  it("does not count the look-alikes: deleted text, range marks, a table's inside borders", async () => {
    const layout = await measure(
      `<w:p><w:moveFromRangeStart w:id="2" w:name="m"/><w:moveFromRangeEnd w:id="2"/>${run("Plain")}</w:p>` +
        `<w:tbl><w:tblPr><w:tblBorders><w:insideH w:val="single"/></w:tblBorders></w:tblPr><w:tr><w:tc><w:p>${run("Cell")}</w:p></w:tc></w:tr></w:tbl>`,
    );
    expect(layout.trackedChanges).toBe(0);
  });
});

describe("DOCX comments", () => {
  it("counts the comments in the comments part", async () => {
    const body = `<w:p><w:commentRangeStart w:id="0"/>${run("Built it")}<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>`;
    const layout = await measure(body, [
      ["word/comments.xml", COMMENTS],
      ["word/_rels/document.xml.rels", relationshipsXml([["rId9", "comments", "comments.xml"]])],
    ]);
    expect(layout.comments).toBe(2);
  });

  it("counts the references when the comments part is missing", async () => {
    const body = `<w:p>${run("Built it")}<w:r><w:commentReference w:id="0"/></w:r></w:p>`;
    expect((await measure(body)).comments).toBe(1);
  });

  it("measures a hostile document in linear time", () => {
    const hostile = `<w:p>${"<w:ins <w:del <w:aPrChang <w:commentReference".repeat(40_000)}</w:p>`;
    const docx = buildRichDocx(NAME + hostile);
    expectFast(() => measureDocx(docx), 3_000, "revision marks");
  });
});

describe("encrypted PDF", () => {
  const content = [
    text(72, 720, "Jane Doe"),
    text(72, 700, "jane.doe@example.com"),
    text(72, 680, "Senior Engineer, Acme Corporation, 2020 - Present"),
  ].join("\n");

  it("reports a PDF that opens without a password but carries an owner password", async () => {
    const pdf = buildPdf(content, "", "", [], { trailer: ownerPasswordTrailer() });
    const { text: extracted, layout } = await extractResume(pdf, "pdf");
    expect(extracted).toContain("Jane Doe");
    expect(layout?.encrypted).toBe(true);
  }, 60_000);

  it("reports nothing for an ordinary PDF", async () => {
    const { layout } = await extractResume(buildPdf(content), "pdf");
    expect(layout?.encrypted).toBeUndefined();
  }, 60_000);
});

describe("readResumeFile", () => {
  it("says what the file was: its name, size and format", async () => {
    const docx = buildDocx([
      "Jane Doe",
      "jane.doe@example.com",
      "Experience",
      "Engineer at Acme, 2019 - 2022",
      "Built the ledger service in Go",
    ]);
    const path = join(dir, "Resume_final (2).docx");
    writeFileSync(path, docx);
    const read = await readResumeFile(path);
    expect(read.file).toEqual({
      name: "Resume_final (2).docx",
      bytes: docx.length,
      format: "docx",
    });
  });

  it("names a text or JSON file too", async () => {
    const path = join(dir, "cv.txt");
    writeFileSync(
      path,
      "Jane Doe\njane@example.com\nExperience\nEngineer at Acme, 2019 - 2022\n- Built it",
    );
    expect((await readResumeFile(path)).file).toMatchObject({ name: "cv.txt", format: "text" });
  });
});
