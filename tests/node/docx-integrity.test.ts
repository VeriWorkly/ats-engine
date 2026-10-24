import { describe, expect, it } from "vitest";

import { DEFAULT_POLICY, check } from "../../src/index.js";
import { measureDocx } from "../../src/node/docx.js";
import { extractResume } from "../../src/node/index.js";
import { buildDocxBody } from "../fixtures/buildDocx.js";
import { expectFast } from "../fixtures/timing.js";

/**
 * Word documents: hidden runs, tables and photos read from the document XML, each beside the
 * honest look-alike that must not be flagged. Built deflated, as Word writes them, and stored.
 */

const KEYWORDS = "Kubernetes Terraform Kafka GraphQL Rust";
const p = (props: string, text: string, paragraph = "") =>
  `<w:p>${paragraph}<w:r><w:rPr>${props}</w:rPr><w:t>${text}</w:t></w:r></w:p>`;
const NAME = p("", "Jane Doe, Senior Engineer at Acme");

const measure = async (body: string, deflate = true) =>
  (await extractResume(buildDocxBody(NAME + body, deflate), "docx")).layout!;

describe("hidden runs", () => {
  it.each([
    ["marked hidden", p("<w:vanish/>", KEYWORDS)],
    ["in a 1pt font", p('<w:sz w:val="2"/>', KEYWORDS)],
    ["white on the page", p('<w:color w:val="FFFFFF"/>', KEYWORDS)],
    ["near-white on the page", p('<w:color w:val="F7F7F7"/>', KEYWORDS)],
  ])("finds text %s", async (_, body) => {
    const layout = await measure(body);
    expect(layout).toMatchObject({ hiddenTextChars: 35, hiddenText: KEYWORDS });
  });

  it.each([
    [
      "white on a dark run shading",
      p('<w:color w:val="FFFFFF"/><w:shd w:val="clear" w:fill="1F2937"/>', KEYWORDS),
    ],
    [
      "white on a dark paragraph",
      p(
        '<w:color w:val="FFFFFF"/>',
        KEYWORDS,
        '<w:pPr><w:shd w:val="clear" w:fill="111111"/></w:pPr>',
      ),
    ],
    [
      "white in a dark table cell",
      `<w:tbl><w:tr><w:tc><w:tcPr><w:shd w:val="clear" w:fill="0F172A"/></w:tcPr>${p('<w:color w:val="FFFFFF"/>', KEYWORDS)}</w:tc></w:tr></w:tbl>`,
    ],
    ["a hidden flag turned off", p('<w:vanish w:val="0"/>', KEYWORDS)],
    ["grey body text", p('<w:color w:val="595959"/>', KEYWORDS)],
    ["a 9pt footnote", p('<w:sz w:val="18"/>', "Page 1 of 2")],
  ])("does not flag %s", async (_, body) => {
    expect((await measure(body)).hiddenTextChars).toBe(0);
  });

  it("finds text squashed to a sliver", async () => {
    const layout = await measure(p('<w:w w:val="1"/>', KEYWORDS));
    expect(layout).toMatchObject({ hiddenTextChars: 35, hiddenText: KEYWORDS });
    expect((await measure(p('<w:w w:val="90"/>', KEYWORDS))).hiddenTextChars).toBe(0);
  });

  // A style hides what it is applied to as direct formatting does.
  const STYLES = (look: string) =>
    `<?xml version="1.0"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="character" w:styleId="Quiet"><w:rPr>${look}</w:rPr></w:style><w:style w:type="paragraph" w:styleId="Fine"><w:basedOn w:val="Normal"/><w:rPr>${look}</w:rPr></w:style><w:style w:type="paragraph" w:styleId="Finer"><w:basedOn w:val="Fine"/></w:style></w:styles>`;
  const styled = (look: string, body: string) =>
    extractResume(
      buildDocxBody(NAME + body, true, [["word/styles.xml", STYLES(look)]]),
      "docx",
    ).then(({ layout }) => layout!);

  it.each([
    ["marked hidden", "<w:vanish/>"],
    ["white", '<w:color w:val="FFFFFF"/>'],
    ["in a 1pt font", '<w:sz w:val="2"/>'],
    ["squashed to a sliver", '<w:w w:val="1"/>'],
  ])("finds text in a style %s", async (_, look) => {
    for (const body of [
      p('<w:rStyle w:val="Quiet"/>', KEYWORDS),
      p("", KEYWORDS, '<w:pPr><w:pStyle w:val="Fine"/></w:pPr>'),
      p("", KEYWORDS, '<w:pPr><w:pStyle w:val="Finer"/></w:pPr>'),
    ])
      expect(await styled(look, body), body).toMatchObject({
        hiddenTextChars: 35,
        hiddenText: KEYWORDS,
      });
  });

  it("lets a run's own formatting undo its style's", async () => {
    const body = p('<w:rStyle w:val="Quiet"/><w:vanish w:val="0"/>', KEYWORDS);
    expect((await styled("<w:vanish/>", body)).hiddenTextChars).toBe(0);
    const grey = p('<w:rStyle w:val="Quiet"/><w:color w:val="333333"/>', KEYWORDS);
    expect((await styled('<w:color w:val="FFFFFF"/>', grey)).hiddenTextChars).toBe(0);
  });

  // Word shows an alternate-content block's Choice; `mammoth` reads its Fallback.
  const alternate = (choice: string, fallback: string) =>
    `<w:p><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice Requires="wps"><w:r><w:t>${choice}</w:t></w:r></mc:Choice><mc:Fallback><w:r><w:t>${fallback}</w:t></w:r></mc:Fallback></mc:AlternateContent></w:p>`;

  it("finds text read from an alternate-content Fallback that Word does not show", async () => {
    const { text, layout } = await extractResume(
      buildDocxBody(NAME + alternate("Team player", KEYWORDS), true),
      "docx",
    );
    expect(text).toContain(KEYWORDS);
    expect(layout).toMatchObject({ hiddenTextChars: 35, hiddenText: KEYWORDS });
    expect(layout?.hiddenTextRead).toBe(KEYWORDS);
  });

  it("does not flag a Fallback that repeats its Choice, nor a hidden run in a Choice it does not read", async () => {
    expect((await measure(alternate(KEYWORDS, KEYWORDS))).hiddenTextChars).toBe(0);
    const vanished = alternate(`</w:t></w:r><w:r><w:rPr><w:vanish/></w:rPr><w:t>Rust`, "Rust");
    expect((await measure(vanished)).hiddenTextChars).toBe(0);
  });

  it("reads alternate content nested and unclosed in linear time", () => {
    const open = '<mc:AlternateContent><mc:Choice Requires="wps">';
    for (const body of [
      open.repeat(20_000) + "<w:r><w:t>a</w:t></w:r>",
      "<mc:AlternateContent><mc:Fallback><w:r><w:t>a</w:t></w:r></mc:Fallback>".repeat(20_000),
      `${"<mc:Choice ".repeat(20_000)}`,
    ])
      expectFast(() => measureDocx(buildDocxBody(NAME + body, true)), 2_000);
  });

  it("reads stored archives as well as deflated ones", async () => {
    expect((await measure(p("<w:vanish/>", KEYWORDS), false)).hiddenTextChars).toBe(35);
  });

  it("reports it on the resume, quoting it", async () => {
    const { text, layout } = await extractResume(
      buildDocxBody(NAME + p('<w:color w:val="FFFFFF"/>', `${KEYWORDS} ${KEYWORDS}`), true),
      "docx",
    );
    const rule = check(text, DEFAULT_POLICY, { layout }).rules.find(
      (r) => r.id === "ats-v2.integrity.hiddenText",
    );
    expect(rule).toMatchObject({ passed: false, scoreImpact: 30 });
    expect(rule?.evidence).toContain("Kubernetes Terraform");
  });
});

describe("tables and photos", () => {
  it("counts layout tables, which extract out of order", async () => {
    const table = `<w:tbl><w:tr><w:tc>${p("", "Left")}</w:tc><w:tc>${p("", "Right")}</w:tc></w:tr></w:tbl>`;
    expect((await measure(table)).tableCount).toBe(1);
  });

  it("counts a photo by its printed size", async () => {
    const drawing = (inches: number) =>
      `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="${inches * 914_400}" cy="${inches * 914_400}"/><a:graphic><a:graphicData><pic:pic/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    expect((await measure(drawing(1.2))).imageCount).toBe(1);
    expect((await measure(drawing(0.3))).imageCount).toBe(0);
  });
});
