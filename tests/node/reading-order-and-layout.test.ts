import { describe, expect, it } from "vitest";

import { fromJsonResume } from "../../src/document/jsonResume.js";
import { check, DEFAULT_POLICY } from "../../src/index.js";
import { extractJobPosting, jobHtmlToText, jobTextFromHtml } from "../../src/job/index.js";
import { measureDocx } from "../../src/node/docx.js";
import { detectResumeFormat, extractResume } from "../../src/node/extract.js";
import { joinPages, pageText } from "../../src/node/lines.js";
import {
  buildDocxBody,
  buildRichDocx,
  marginXml,
  relationshipsXml,
} from "../fixtures/buildDocx.js";
import { buildPdf, buildPdfPages, stream } from "../fixtures/buildPdf.js";

/**
 * Regressions for the file-extraction audit: each block names the finding it protects. Invented
 * people throughout.
 */

const pdf = (
  ops: string,
  ...rest: Parameters<typeof buildPdf> extends [string, ...infer R] ? R : never
) => extractResume(buildPdf(ops, ...rest), "pdf");
const lines = (extracted: string) => extracted.split("\n").filter(Boolean);
/** Text at a position in a given size. */
const at = (x: number, y: number, value: string, size = 10) =>
  `BT /F1 ${size} Tf ${x} ${y} Td (${value}) Tj ET`;
const p = (value: string, runProperties = "") =>
  `<w:p><w:r>${runProperties && `<w:rPr>${runProperties}</w:rPr>`}<w:t xml:space="preserve">${value}</w:t></w:r></w:p>`;

describe("PDF text is read in reading order, not paint order", () => {
  it("reads a floated date beside its title, though the page paints it first", async () => {
    // Chrome paints `float: right` before the inline text around it: every date came out above
    // the name, and no role was recovered.
    const ops = [
      at(470, 700, "May 2020 - Present"),
      at(470, 640, "Aug 2016 - Apr 2020"),
      at(45, 740, "Ethan Walker", 20),
      at(45, 700, "Site Reliability Engineer, Indeed"),
      at(60, 685, "Cut paging volume 45% by rebuilding alert routing."),
      at(45, 640, "Systems Engineer, Rackspace"),
    ].join("\n");
    expect(lines((await pdf(ops)).text)).toEqual([
      "Ethan Walker",
      "Site Reliability Engineer, Indeed\tMay 2020 - Present",
      "Cut paging volume 45% by rebuilding alert routing.",
      "Systems Engineer, Rackspace\tAug 2016 - Apr 2020",
    ]);
  });

  it("reads a block painted after the rest where it sits on the page", async () => {
    // Relatively positioned or semi-transparent blocks are painted last: "EXPERIENCE\nEDUCATION"
    // and then every job.
    const ops = [
      at(45, 760, "Tomasz Nowak", 20),
      at(45, 700, "EXPERIENCE", 12),
      at(45, 600, "EDUCATION", 12),
      at(60, 680, "Staff Engineer, Datadog"),
      at(60, 666, "Jan 2021 - Present"),
      at(60, 580, "B.S. Computer Engineering, Rutgers University"),
    ].join("\n");
    expect(lines((await pdf(ops)).text)).toEqual([
      "Tomasz Nowak",
      "EXPERIENCE",
      "Staff Engineer, Datadog",
      "Jan 2021 - Present",
      "EDUCATION",
      "B.S. Computer Engineering, Rutgers University",
    ]);
  });

  it("puts a running header painted last at the top of the page", async () => {
    const ops = [at(45, 700, "Experience"), at(45, 680, "Engineer, Acme"), at(45, 770, "Mia Chen")];
    expect(lines((await pdf(ops.join("\n"))).text)[0]).toBe("Mia Chen");
  });

  it("reads a large name before the right-aligned contact block beside it", async () => {
    // The contact block's first line sits above the name's baseline; by baseline alone the
    // email came first and the parser took a heading for the name.
    const ops = [
      at(47, 758, "Rahul Sharma", 24),
      at(47, 742, "Data Engineer", 10.5),
      at(442, 768, "rahul.sharma@example.in", 9),
      at(480, 757, "+91 98765 43210", 9),
      at(481, 747, "Bengaluru, India", 9),
      at(34, 691, "Professional Summary", 12),
      at(
        34,
        666,
        "Data engineer with six years of experience designing batch and streaming pipelines.",
      ),
    ].join("\n");
    const read = lines((await pdf(ops)).text);
    expect(read[0]).toBe("Rahul Sharma");
    expect(read.slice(1, 3)).toEqual(["rahul.sharma@example.in", "+91 98765 43210"]);
  });

  it("reads a heading across both columns first, then each column in turn", async () => {
    const left = Array.from({ length: 8 }, (_, row) => `Left column line ${row + 1}`);
    // A column's lines are ragged; lines that all end flush right would be tab stops.
    const right = Array.from(
      { length: 8 },
      (_, row) => `Right column ${"item ".repeat(row % 3)}line ${row + 1}`,
    );
    const ops = [
      ...left.flatMap((line, row) => [
        at(45, 700 - row * 20, line),
        at(340, 700 - row * 20, right[row]!),
      ]),
      at(45, 750, "Jane Doe, Senior Software Engineer and Platform Lead, San Francisco CA"),
    ].join("\n");
    const { text: extracted, layout } = await pdf(ops);
    expect(layout?.columnRatio).toBeGreaterThan(0.4);
    expect(lines(extracted)).toEqual([
      "Jane Doe, Senior Software Engineer and Platform Lead, San Francisco CA",
      ...left,
      ...right,
    ]);
  });
});

describe("a text effect's transparent copy is neither hidden text nor a second copy", () => {
  const transparent = "/ExtGState<</T0<</ca 0>>>>";

  it("reads text with a shadow once, and does not flag its selectable copy", async () => {
    const ops = [
      `q /T0 gs ${at(50.75, 699.25, "Senior UX Researcher", 16)} Q`,
      at(50, 700, "Senior UX Researcher", 16),
    ].join("\n");
    const { text: extracted, layout } = await pdf(ops, transparent);
    expect(lines(extracted)).toEqual(["Senior UX Researcher"]);
    expect(layout?.hiddenTextChars).toBe(0);
  });

  it("does not flag gradient text, whose glyphs are drawn as the mask the gradient fills", async () => {
    const mask = stream(
      "/Type/XObject/Subtype/Form/BBox[0 0 612 792]/Group<</S/Transparency/CS/DeviceGray>>/Resources<</Font<</F1 4 0 R>>>>",
      `1 g ${at(50, 700, "ALEXANDRA KOWALSKI", 20)}`,
    );
    const { text: extracted, layout } = await pdf(
      `q /SM gs 0.2 0.3 0.9 rg 40 690 400 30 re f Q q /T0 gs ${at(50, 700, "ALEXANDRA KOWALSKI", 20)} Q`,
      "/ExtGState<</SM<</SMask<</S/Luminosity/G 7 0 R>>>>/T0<</ca 0>>>>",
      "",
      [mask],
    );
    expect(extracted).toBe("ALEXANDRA KOWALSKI");
    expect(layout?.hiddenTextChars).toBe(0);
  });

  it("still flags transparent text that copies nothing visible", async () => {
    const ops = [
      at(50, 700, "Jane Doe"),
      `q /T0 gs ${at(50, 600, "Kubernetes Terraform Golang Rust")} Q`,
    ].join("\n");
    expect((await pdf(ops, transparent)).layout?.hiddenTextChars).toBe(29);
  });
});

describe("every page whose text is read is measured", () => {
  it("finds white text on page 7", async () => {
    const pages = [
      `${at(50, 700, "Leo Park")}\n${at(50, 680, "Engineer, Acme, 2019 - Present")}`,
      ...Array.from({ length: 5 }, (_, page) => at(50, 700, `Page ${page + 2}`)),
      `1 1 1 rg ${at(50, 600, "Kubernetes Terraform Golang Rust Snowflake Databricks")}`,
    ];
    const { layout } = await extractResume(buildPdfPages(pages), "pdf");
    expect(layout?.pageCount).toBe(7);
    expect(layout?.hiddenTextChars).toBe(48);
  });

  it("refuses a DOCX padded past what can be measured, rather than reading it unmeasured", async () => {
    const body = `${p("Ana Silva")}${p("Kubernetes Terraform Golang Rust", '<w:color w:val="FFFFFF"/>')}<!--${"x".repeat(9 * 1024 * 1024)}-->`;
    const docx = buildDocxBody(body, true);
    expect(() => measureDocx(docx)).toThrow(/8 MB/);
    await expect(extractResume(docx, "docx")).rejects.toThrow(/8 MB/);
  });
});

describe("DOCX headers and footers are read", () => {
  it("puts the header before the body and the footer after it, without page numbers", async () => {
    const docx = buildDocxBody(
      `${p("Experience")}${p("Senior Backend Engineer, HubSpot")}`,
      false,
      [
        [
          "word/header1.xml",
          marginXml("hdr", p("Daniel Fischer") + p("daniel.fischer@example.com")),
        ],
        ["word/header2.xml", marginXml("hdr", p("Daniel Fischer"))],
        ["word/footer1.xml", marginXml("ftr", p("References available on request") + p("2"))],
      ],
    );
    expect(lines((await extractResume(docx, "docx")).text)).toEqual([
      "Daniel Fischer",
      "daniel.fischer@example.com",
      "Experience",
      "Senior Backend Engineer, HubSpot",
      "References available on request",
    ]);
  });
});

describe("a PDF's running header and footer are read once, and its page numbers not at all", () => {
  // A role whose title ends page 1 and whose dates open page 2, with the page's footer and the
  // next page's header printed between them.
  const HEADER = "Jordan Ellery - Resume | jordan.ellery@example.com";
  const pages = (header: "both" | "later" | "none") => {
    const first = [
      at(45, 740, "Jordan Ellery", 20),
      at(45, 722, "jordan.ellery@example.com | (415) 555-0132"),
      at(45, 690, "EXPERIENCE", 12),
      at(45, 670, "Staff Engineer, Initech"),
      at(470, 670, "Mar 2021 - Present"),
      at(60, 654, "- Built the payments platform used by forty teams"),
      at(45, 60, "Senior Engineer, Hooli"),
      at(520, 30, "Page 1 of 2", 8),
    ];
    const second = [
      at(45, 740, "Jan 2017 - Feb 2021"),
      at(60, 726, "- Built the search ranking service"),
      at(45, 690, "EDUCATION", 12),
      at(45, 674, "B.S. Mathematics, Ohio State University, 2016"),
      at(520, 30, "Page 2 of 2", 8),
    ];
    if (header === "both") first.unshift(at(45, 770, HEADER, 8));
    if (header !== "none") second.unshift(at(45, 770, HEADER, 8));
    return buildPdfPages([first.join("\n"), second.join("\n")]);
  };
  const read = async (header: "both" | "later" | "none") => {
    const { text } = await extractResume(pages(header), "pdf");
    const report = check(text, DEFAULT_POLICY, { now: new Date("2026-10-01T00:00:00Z") });
    return { text, roles: report.parsed.roles.map((role) => [role.title, role.employer]) };
  };
  const ROLES = [
    ["Staff Engineer", "Initech"],
    ["Senior Engineer", "Hooli"],
  ];

  it("keeps a role whose title and dates the page break parts", async () => {
    for (const header of ["both", "later", "none"] as const)
      expect((await read(header)).roles).toEqual(ROLES);
  });

  it("reads a header printed on every page once, before the text", async () => {
    const { text } = await read("both");
    expect(lines(text)[0]).toBe(HEADER);
    expect(text.split(HEADER)).toHaveLength(2);
    expect(text).not.toMatch(/Page \d of 2/);
  });

  it("drops a later page's header that repeats the name the first page opens with", async () => {
    expect((await read("later")).text).not.toContain("Resume");
  });

  it("keeps a line repeated on two pages in their body, or at another height", async () => {
    const page = (name: string, y: number) =>
      [
        at(45, 740, name),
        at(45, 700, "- Led the platform team"),
        at(45, 600, "Kubernetes, Terraform"),
        at(45, 500, "- Cut cloud spend by 31%"),
        at(45, y, "2019 - 2021"),
      ].join("\n");
    const { text } = await extractResume(
      buildPdfPages([page("Jordan Ellery", 30), page("Senior Engineer, Hooli", 40)]),
      "pdf",
    );
    expect(text.split("Kubernetes, Terraform")).toHaveLength(3);
    expect(text.split("2019 - 2021")).toHaveLength(3);
  });

  it("stays linear over thousands of pages printing the same lines", () => {
    const pages = Array.from({ length: 20_000 }, (_, page) => ({
      lines: ["Jordan Ellery", "x", "y", `Page ${page}`],
      ys: [10, 10.5, 11, 11.5],
    }));
    const started = performance.now();
    // The first two lines of a page are its header, the last two its footer.
    expect(joinPages(pages)).toBe("Jordan Ellery\nx\n\ny\n\n");
    expect(performance.now() - started).toBeLessThan(1_000);
  });
});

describe("right-aligned dates on a single-column page are not a second column", () => {
  it("reads them as tab stops of their lines", async () => {
    // Helvetica's digits are 5.56pt wide at 10pt, its space 2.78pt and its hyphen 3.33pt, so
    // each date ends at x = 560.
    const roles: Array<[string, string, number]> = [
      ["Site Reliability Engineer, Indeed", "06 2019 - 08 2021", 81.17],
      ["Systems Engineer, Rackspace", "2017 - 2019", 53.37],
      ["Support Engineer, Initech", "03 2015 - 2017", 67.27],
      ["Intern, Globex Corporation", "2014", 22.24],
    ];
    const ops = roles
      .flatMap(([title, dates, width], index) => [
        at(45, 700 - index * 40, title),
        at(560 - width, 700 - index * 40, dates),
        at(60, 686 - index * 40, "Built CI pipelines"),
      ])
      .join("\n");
    const { text: extracted, layout } = await pdf(ops);
    expect(layout?.columnRatio).toBeLessThan(0.15);
    expect(lines(extracted)[0]).toBe("Site Reliability Engineer, Indeed\t06 2019 - 08 2021");
  });
});

describe("white text on a shaded paragraph style is not hidden", () => {
  const styles = `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Band"><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="1F3864"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="BandHeading"><w:basedOn w:val="Band"/></w:style><w:style w:type="paragraph" w:styleId="Plain"><w:rPr><w:b/></w:rPr></w:style></w:styles>`;
  const heading = (style: string) =>
    `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr><w:r><w:rPr><w:color w:val="FFFFFF"/></w:rPr><w:t>PROFESSIONAL EXPERIENCE</w:t></w:r></w:p>`;
  const hidden = (style: string) =>
    measureDocx(buildDocxBody(heading(style), false, [["word/styles.xml", styles]]))?.hiddenChars;

  it("reads the style's shading, through basedOn", () => {
    expect(hidden("Band")).toBe(0);
    expect(hidden("BandHeading")).toBe(0);
  });

  it("still flags white text in a style without shading, or one the document does not define", () => {
    expect(hidden("Plain")).toBe(22);
    expect(hidden("Undefined")).toBe(22);
  });
});

describe("phrasing tags join the text they touch", () => {
  it("reads Node.js, TypeScript and C++ from a posting", () => {
    expect(
      jobHtmlToText(
        "<ul><li>Experience with C<sup>++</sup>, Node<span>.js</span> and <b>Type</b>Script</li><li><strong>3</strong>-<strong>5</strong> years</li></ul>",
      ),
    ).toBe("• Experience with C++, Node.js and TypeScript\n• 3-5 years");
  });

  it("keeps sibling skill tags apart", () => {
    expect(
      jobHtmlToText('<div><span class="tag">Spark</span><span class="tag">Kafka</span></div>'),
    ).toBe("Spark Kafka");
  });

  it("reads JavaScript and C# from a DOCX whose runs change formatting mid-word", async () => {
    const docx = buildDocxBody(
      '<w:p><w:r><w:t>Java</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>Script</w:t></w:r><w:r><w:t xml:space="preserve">, C</w:t></w:r><w:r><w:rPr><w:i/></w:rPr><w:t>#</w:t></w:r></w:p>',
    );
    expect((await extractResume(docx, "docx")).text).toBe("JavaScript, C#");
  });

  it("drops the document head and its title", () => {
    expect(
      jobHtmlToText(
        "<html><head><title>Careers | Acme</title></head><body><p>Go</p></body></html>",
      ),
    ).toBe("Go");
  });
});

describe("q/Q restore the text state", () => {
  it("does not carry an invisible or 1pt line's state past its Q", async () => {
    const ops = [
      `q BT 3 Tr /F1 10 Tf 50 700 Td (x) Tj ET Q`,
      `q BT /F1 1 Tf 50 690 Td (.) Tj ET Q`,
      at(50, 650, "Senior Engineer at Acme Corporation since 2019"),
      `BT 50 630 Td (Built payment systems used by two million customers) Tj ET`,
    ].join("\n");
    const { layout } = await pdf(ops);
    expect(layout?.hiddenTextChars).toBe(2);
  });
});

describe("link targets are read", () => {
  it("adds a PDF link's target when the text shows only its label", async () => {
    const { text: extracted } = await pdf(
      at(50, 700, "LinkedIn"),
      "",
      "",
      [
        "<</Type/Annot/Subtype/Link/Rect[50 695 100 710]/A<</S/URI/URI(https://www.linkedin.com/in/jane-doe-42)>>>>",
      ],
      { page: "/Annots[7 0 R]" },
    );
    expect(lines(extracted)).toEqual(["LinkedIn", "https://www.linkedin.com/in/jane-doe-42"]);
  });

  it("does not repeat a target the text already shows", async () => {
    const { text: extracted } = await pdf(
      at(50, 700, "linkedin.com/in/jane-doe-42"),
      "",
      "",
      [
        "<</Type/Annot/Subtype/Link/Rect[50 695 200 710]/A<</S/URI/URI(https://www.linkedin.com/in/jane-doe-42/)>>>>",
      ],
      { page: "/Annots[7 0 R]" },
    );
    expect(extracted).toBe("linkedin.com/in/jane-doe-42");
  });

  it("adds a DOCX hyperlink's and a HYPERLINK field's targets", async () => {
    const docx = buildRichDocx(
      '<w:p><w:hyperlink r:id="rIdL"><w:r><w:t>GitHub</w:t></w:r></w:hyperlink></w:p><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "https://janedoe.dev" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>My website</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
      [
        [
          "word/_rels/document.xml.rels",
          relationshipsXml([["rIdL", "hyperlink", "https://github.com/janedoe"]]),
        ],
      ],
    );
    expect(lines((await extractResume(docx, "docx")).text).slice(-2)).toEqual([
      "https://github.com/janedoe",
      "https://janedoe.dev",
    ]);
  });
});

describe("a job page's furniture is not the posting", () => {
  it("drops navigation, cookie banners, forms, similar jobs and hidden elements", () => {
    const html = `<html><head><title>Acme - Product Designer</title></head><body>
<div class="cookie-consent">This website uses cookies. <button>Accept</button></div>
<header><nav><a>Acme home page</a><a>Jobs</a></nav></header>
<h2>Product Designer</h2><p>We need Figma and user research.</p>
<div class="similar"><h3>Similar jobs</h3><ul><li>Senior iOS Engineer</li></ul></div>
<select name="location"><option>Amsterdam</option><option>London</option></select>
<div hidden>Internal requisition Kubernetes Terraform</div><div style="display: none">Rust Haskell</div><p aria-hidden="true">Erlang</p>
<svg><svg><title>i</title></svg><text>SVGLEAK</text></svg>
<footer>© 2026 Acme · Imprint</footer></body></html>`;
    expect(jobHtmlToText(html)).toBe("Product Designer\nWe need Figma and user research.");
  });

  it("reads the posting from the page's main element when it has one", () => {
    const html = `<body><div>Sign in to see salaries</div><main><header><h1>QA Engineer</h1></header><p>Test automation with Playwright.</p></main><aside>Related: Data Engineer</aside></body>`;
    expect(jobHtmlToText(html)).toBe("QA Engineer\nTest automation with Playwright.");
  });
});

describe("entities beyond the basic few are decoded", () => {
  it("decodes Latin-1 letters and the symbols postings use", () => {
    expect(
      jobHtmlToText(
        "<p>M&uuml;nchen &middot; &euro;80,000 &ndash; &Eacute;cole &Scaron;koda &szlig; &copy;</p>",
      ),
    ).toBe("München · €80,000 – École Škoda ß ©");
  });
});

describe("a DOCX built from an embedded HTML chunk is read", () => {
  it("reads html-docx-js's MHT chunk", async () => {
    const mht = [
      "MIME-Version: 1.0",
      'Content-Type: multipart/related; type="text/html"; boundary="----=mhtDocumentPart"',
      "",
      "------=mhtDocumentPart",
      'Content-Type: text/html; charset="utf-8"',
      "Content-Transfer-Encoding: quoted-printable",
      "",
      '<!DOCTYPE html><html><body><h1 class=3D"name">Jane Roe</h1><p>jane.roe@exam=',
      "ple.com</p><p>Engineer, Acme, 2019 =E2=80=93 Present</p></body></html>",
      "",
      "------=mhtDocumentPart--",
    ].join("\n");
    const docx = buildRichDocx('<w:altChunk r:id="htmlChunk"/>', [
      [
        "word/_rels/document.xml.rels",
        relationshipsXml([["htmlChunk", "aFChunk", "/word/afchunk.mht"]]),
      ],
      ["word/afchunk.mht", mht],
    ]);
    expect(lines((await extractResume(docx, "docx")).text)).toEqual([
      "Jane Roe",
      "jane.roe@example.com",
      "Engineer, Acme, 2019 – Present",
    ]);
  });
});

describe("list markers drawn as shapes are read as bullets", () => {
  it("starts a line with a small filled square just before it with a bullet", async () => {
    // Two items of one list: a lone mark is no list (review #1 of the second pass).
    const ops = [
      at(45, 712, "Experience"),
      `40 698 3 3 re f`,
      at(50, 697, "Cut paging volume 45% by rebuilding alerts."),
      `40 685 3 3 re f`,
      at(50, 684, "Moved deploys to Argo CD."),
      // A timeline dot is larger than a list marker, and stays a dot.
      `38 664 6 6 re f`,
      at(50, 665, "Staff Engineer, Datadog"),
    ].join("\n");
    expect(lines((await pdf(ops)).text)).toEqual([
      "Experience",
      "• Cut paging volume 45% by rebuilding alerts.",
      "• Moved deploys to Argo CD.",
      "Staff Engineer, Datadog",
    ]);
  });

  it("reads the one bullet of a role with one item as a bullet", async () => {
    const ops = [
      at(45, 712, "Experience"),
      at(45, 698, "Staff Engineer, Datadog 2021 - Present"),
      `40 685 3 3 re f`,
      at(50, 684, "Cut paging volume 45% by rebuilding the alerting pipeline."),
    ].join("\n");
    expect(lines((await pdf(ops)).text)).toEqual([
      "Experience",
      "Staff Engineer, Datadog 2021 - Present",
      "• Cut paging volume 45% by rebuilding the alerting pipeline.",
    ]);
  });

  it("leaves a lone dot before a short line a dot", async () => {
    const ops = [
      at(45, 712, "Experience"),
      `40 699 3 3 re f`,
      at(50, 698, "Staff Engineer, Datadog"),
      at(50, 684, "Cut paging volume 45% by rebuilding the alerting pipeline."),
    ].join("\n");
    expect(lines((await pdf(ops)).text)).toEqual([
      "Experience",
      "Staff Engineer, Datadog",
      "Cut paging volume 45% by rebuilding the alerting pipeline.",
    ]);
  });
});

describe("only pictures count as photos in a DOCX", () => {
  const drawing = (graphic: string) =>
    `<w:p><w:r><w:drawing><wp:anchor><wp:extent cx="1800000" cy="3000000"/><a:graphic><a:graphicData>${graphic}</a:graphicData></a:graphic></wp:anchor></w:drawing></w:r></w:p>`;

  it("does not count a text box", () => {
    const box = drawing(
      "<wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>Skills</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp>",
    );
    expect(measureDocx(buildDocxBody(box))?.imageCount).toBe(0);
  });

  it("counts a picture", () => {
    const picture = drawing(
      '<pic:pic><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill></pic:pic>',
    );
    expect(measureDocx(buildDocxBody(picture))?.imageCount).toBe(1);
  });
});

describe("JSON-LD postings in the shapes sites publish", () => {
  const description = `<p>${"We build payment infrastructure in Go and Kubernetes. ".repeat(6)}</p>`;
  const page = (json: string) =>
    `<html><head><script type="application/ld+json">${json}</script></head><body>x</body></html>`;

  it("reads structured requirements, a URI type and an employer given by reference", () => {
    const posting = extractJobPosting(
      page(
        JSON.stringify({
          "@context": "https://schema.org",
          "@graph": [
            { "@type": "Organization", name: "Globex" },
            {
              "@type": "http://schema.org/JobPosting",
              title: "Data Engineer",
              hiringOrganization: { "@id": "#org" },
              description,
              educationRequirements: {
                "@type": "EducationalOccupationalCredential",
                credentialCategory: "bachelor degree",
              },
              experienceRequirements: {
                "@type": "OccupationalExperienceRequirements",
                monthsOfExperience: 60,
              },
            },
          ],
        }),
      ),
    );
    expect(posting).toMatchObject({
      title: "Data Engineer",
      company: "Globex",
      requirements: ["5 years of experience", "bachelor degree"],
    });
  });

  it("reads JSON-LD wrapped in CDATA, or with raw line breaks inside its strings", () => {
    const wrapped = `//<![CDATA[\n${JSON.stringify({ "@type": "JobPosting", title: "CData", description })}\n//]]>`;
    expect(extractJobPosting(page(wrapped))?.title).toBe("CData");
    const raw = `{"@type":"JobPosting","title":"Raw","description":"line one\nline two ${"x ".repeat(120)}"}`;
    expect(jobTextFromHtml(page(raw))).toContain("line one line two");
  });
});

describe("the hidden-text sample reads as words", () => {
  it("joins glyphs drawn one at a time", async () => {
    const glyphs = [..."Kubernetes Terraform"].map((char) => `(${char}) Tj`).join(" ");
    const { layout } = await pdf(
      `${at(50, 700, "Jane Doe")}\n1 1 1 rg BT /F1 10 Tf 50 600 Td ${glyphs} ET`,
    );
    expect(layout?.hiddenTextSample).toBe("Kubernetes Terraform");
  });
});

describe("formats and encodings", () => {
  it.each([
    ["cv.pdf", "application/pdf; charset=binary", "pdf"],
    ["upload", "Application/PDF", "pdf"],
    ["cv.html", "", "html"],
    ["upload", "text/html; charset=utf-8", "html"],
    ["cv.rtf", "", null],
    ["upload", "text/rtf", null],
    ["notes.txt", "text/plain; charset=utf-8", "text"],
  ])("%s (%s) is %s", (name, mime, format) => {
    expect(detectResumeFormat(name, mime)).toBe(format);
  });

  it("reads an HTML resume's visible text, not its markup", async () => {
    const html =
      "<html><head><title>CV</title><style>h1{}</style></head><body><h1>Jane Doe</h1><p>Node<span>.js</span> &amp; Go</p></body></html>";
    expect(lines((await extractResume(Buffer.from(html), "html")).text)).toEqual([
      "Jane Doe",
      "Node.js & Go",
    ]);
  });

  it("decodes UTF-16 by its byte-order mark, and Windows-1252 where the bytes are not UTF-8", async () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("Zoë Müller", "utf16le")]);
    expect((await extractResume(utf16, "text")).text).toBe("Zoë Müller");
    const cp1252 = Buffer.from([0x5a, 0x6f, 0xeb, 0x20, 0x93, 0x51, 0x41, 0x94]);
    expect((await extractResume(cp1252, "text")).text).toBe("Zoë “QA”");
  });

  it("refuses a format it does not know rather than reading it as text", async () => {
    await expect(extractResume(Buffer.from("{\\rtf1 x}"), "rtf" as never)).rejects.toThrow(
      /Unsupported/,
    );
  });
});

describe("pdf.js errors are explained", () => {
  it("says a file is not a readable PDF", async () => {
    await expect(extractResume(Buffer.from("not a pdf at all"), "pdf")).rejects.toThrow(
      "The file could not be read as a PDF; it may be damaged.",
    );
  });

  it("says a PDF is password-protected", async () => {
    const key = `<${"11".repeat(32)}>`;
    const encrypted = buildPdf(
      at(50, 700, "secret"),
      "",
      "",
      [`<</Filter/Standard/V 1/R 2/O${key}/U${key}/P -44>>`],
      {
        trailer:
          "/Encrypt 7 0 R/ID[<0123456789abcdef0123456789abcdef><0123456789abcdef0123456789abcdef>]",
      },
    );
    await expect(extractResume(encrypted, "pdf")).rejects.toThrow(/password-protected/);
  });
});

describe("JSON Resume fields the document can hold", () => {
  it("keeps profiles without a URL, a pre-1.0 company, and an education's score and courses", () => {
    const document = fromJsonResume({
      basics: {
        name: "Jane Doe",
        profiles: [{ network: "GitHub", username: "janedoe" }, { network: "Mastodon" }],
      },
      work: [{ company: "Acme", position: "Engineer", startDate: "2019-01" }],
      education: [
        {
          institution: "State University",
          studyType: "BS",
          score: "3.8",
          courses: ["Algorithms", "Compilers"],
        },
      ],
    });
    expect(document.basics.links).toEqual(["GitHub: janedoe"]);
    expect(document.sections).toContainEqual(
      expect.objectContaining({
        kind: "experience",
        items: [expect.objectContaining({ employer: "Acme" })],
      }),
    );
    expect(document.sections).toContainEqual(
      expect.objectContaining({
        kind: "education",
        items: [expect.objectContaining({ summary: "3.8; Algorithms, Compilers" })],
      }),
    );
  });
});

describe("a wide gap between runs on a line is a cell gap", () => {
  it("separates skill tags and table cells pdf.js saw as one space, and keeps word spaces", async () => {
    // As Chrome prints them: each tag its own run, the gap between reported as a space.
    const ops = [
      "BT /F1 9 Tf 40 700 Td (Spark) Tj 35 0 Td (Kafka) Tj 35 0 Td (Airflow) Tj ET",
      "BT /F1 10 Tf 40 680 Td (Tools) Tj 36 0 Td (dbt, Terraform) Tj ET",
      "BT /F1 10 Tf 40 660 Td (Built) Tj 26 0 Td (pipelines) Tj ET",
    ].join("\n");
    expect(lines((await pdf(ops)).text)).toEqual([
      "Spark\tKafka\tAirflow",
      "Tools\tdbt, Terraform",
      "Built pipelines",
    ]);
  });
});

describe("letter-spaced text keeps its word breaks", () => {
  it("puts a tab between letter-spaced words pdf.js kept apart", async () => {
    // "L U C A S M O R E A U" with single spaces read as one word, "LUCASMOREAU".
    const { text: extracted } = await pdf("BT /F1 20 Tf 6 Tc 50 700 Td (LUCAS MOREAU) Tj ET");
    expect(extracted).toBe("L U C A S\tM O R E A U");
  });

  it("puts a tab where a line drawn a glyph at a time has a wider gap", async () => {
    const glyphs = [..."LUCAS"].map((char, index) => at(50 + index * 30, 700, char, 20));
    const surname = [..."MOREAU"].map((char, index) => at(240 + index * 30, 700, char, 20));
    const { text: extracted } = await pdf([...glyphs, ...surname].join("\n"));
    expect(extracted).toBe("L U C A S\tM O R E A U");
  });
});

describe("hiddenText carries all of the hidden text", () => {
  it("holds what the 80-character sample cuts off, from a PDF and a DOCX", async () => {
    const words =
      "Kubernetes Terraform Golang Rust Snowflake Databricks Kafka Spark Airflow dbt Flink Pulsar";
    const fromPdf = (await pdf(`${at(50, 700, "Jane Doe")}\n1 1 1 rg ${at(20, 600, words, 8)}`))
      .layout;
    expect(fromPdf?.hiddenTextSample).toHaveLength(80);
    expect(fromPdf?.hiddenText).toBe(words);
    const docx = buildDocxBody(p("Jane Doe") + p(words, "<w:vanish/>"));
    const fromDocx = (await extractResume(docx, "docx")).layout;
    expect(fromDocx?.hiddenText).toBe(words);
  });
});

describe("the new scans stay linear on hostile input", () => {
  /** The fastest of three runs, so a busy machine cannot fail the test; a quadratic scan still does. */
  const fastest = (run: () => unknown) =>
    Math.min(
      ...[0, 1, 2].map(() => {
        const started = performance.now();
        run();
        return performance.now() - started;
      }),
    );

  it.each([
    ["nested hidden elements", '<div hidden><div class="x">'.repeat(100_000)],
    [
      "hidden elements of distinct names",
      Array.from({ length: 100_000 }, (_, index) => `<x${index} hidden></x${index}>`).join(""),
    ],
    ["unclosed svg inside svg", "<svg><svg>".repeat(200_000)],
    ["closes without opens", "</svg></main>".repeat(150_000)],
    [
      "long attribute values",
      `<div class="${"cookie ".repeat(250_000)}" style="${"x:y;".repeat(100_000)}">x</div>`,
    ],
    ["main opened and never closed", "<main>".repeat(300_000)],
    ["entities", "&eacute;&Scaron;&euro;&bogus;".repeat(70_000)],
  ])("reads a 2 MB page of %s as a job page quickly", (_, html) => {
    expect(fastest(() => jobHtmlToText(html))).toBeLessThan(2_000);
  });
});

describe("a sidebar taller than the main column is a column", () => {
  // The name and headline across the top, a sidebar that runs on below the work history beside
  // it. Measured from the sidebar's side, under half of its text lay beside the main column, so
  // no gutter was found: the lines were read across both columns, a role's employer became
  // "jordan.ellery@example.com, Acme Corp", and the skills were lost.
  const sidebar = [
    [700, "CONTACT", 11],
    [684, "jordan.ellery@example.com", 8],
    [672, "(415) 555-0132", 8],
    [660, "Austin, TX", 8],
    [630, "SKILLS", 11],
    [614, "TypeScript", 9],
    [602, "Go", 9],
    [590, "PostgreSQL", 9],
    [578, "Kubernetes", 9],
    [548, "EDUCATION", 11],
    [532, "B.S. Computer Science", 9],
    [520, "Ohio State University", 9],
    [508, "2012 - 2016", 9],
  ] as const;
  const main = [at(200, 700, "EXPERIENCE", 11)];
  let y = 684;
  for (const [header, dates] of [
    ["Senior Software Engineer, Acme Corp", "Jan 2020 - Present"],
    ["Software Engineer, Globex Inc", "Jun 2016 - Dec 2019"],
  ]) {
    main.push(at(200, y, header), at(480, y, dates));
    y -= 13;
    for (const bullet of [
      "- Built a billing service handling 2M requests a day",
      "- Cut cloud spend by 31% moving batch to spot",
      "- Led migration of 40 services to Kubernetes",
    ]) {
      main.push(at(210, y, bullet, 9));
      y -= 12;
    }
    y -= 8;
  }
  const ops = [
    at(45, 750, "Jordan Ellery", 22),
    at(45, 732, "Senior Software Engineer"),
    ...sidebar.map(([line, value, size]) => at(40, line, value, size)),
    ...main,
  ].join("\n");

  it("reads each column whole and reports the second column", async () => {
    const { text: extracted, layout } = await pdf(ops);
    expect(layout?.columnRatio).toBeGreaterThan(0.15);
    const report = check(extracted, DEFAULT_POLICY, {
      now: new Date("2026-10-01T00:00:00Z"),
      layout,
    });
    expect(report.parsed.roles.map((role) => [role.title, role.employer])).toEqual([
      ["Senior Software Engineer", "Acme Corp"],
      ["Software Engineer", "Globex Inc"],
    ]);
    expect(report.parsed.skills).toEqual(["TypeScript", "Go", "PostgreSQL", "Kubernetes"]);
  });

  it("is no column on a one-column page with a few right-aligned lines at its top and foot", () => {
    // The name at the left and the contact block right-aligned beside it, the dates under the
    // titles, an education year right-aligned, and a page number at the foot.
    const run = (str: string, x: number, y: number, width: number, size = 10) => ({
      str,
      transform: [size, 0, 0, size, x, y],
      width,
      height: size,
      hasEOL: false,
    });
    const right = (str: string, y: number, width: number, size = 9) =>
      run(str, 560 - width, y, width, size);
    const items = [
      run("Jordan Ellery", 45, 740, 140, 22),
      run("Senior Software Engineer", 45, 720, 120),
      right("jordan.ellery@example.com", 745, 110),
      right("(415) 555-0132", 733, 62),
      right("Austin, TX", 721, 44),
      run("EXPERIENCE", 45, 680, 75, 12),
    ];
    let y = 662;
    for (const [header, dates] of [
      ["Senior Software Engineer, Acme Corp", "Jan 2020 - Present"],
      ["Software Engineer, Globex Inc", "Jun 2016 - Dec 2019"],
      ["Junior Developer, Initech", "May 2014 - May 2016"],
    ]) {
      items.push(run(header!, 45, y, 180), run(dates!, 45, y - 13, 90));
      y -= 26;
      for (const bullet of [
        "- Built a billing service handling two million requests a day",
        "- Cut cloud spend by 31% by moving batch jobs to spot instances",
      ]) {
        items.push(run(bullet, 55, y, 270, 9));
        y -= 12;
      }
      y -= 8;
    }
    items.push(
      run("EDUCATION", 45, y, 70, 12),
      run("B.S. Computer Science, Ohio State University", 45, y - 18, 220),
      right("2012 - 2016", y - 18, 55, 10),
      run("SKILLS", 45, y - 43, 45, 12),
      run("TypeScript, Go, PostgreSQL, Kubernetes, Terraform", 45, y - 61, 250),
      right("Page 1 of 1", 40, 40, 8),
    );
    const { text: extracted, columns } = pageText(items, (x, yy) => [x, 792 - yy], 612);
    expect(columns).toBe(0);
    const lines = extracted.split("\n");
    expect(lines.findIndex((line) => line.includes("Austin, TX"))).toBeLessThan(
      lines.indexOf("EXPERIENCE"),
    );
  });
});

describe("a centred heading over a short block is not a second column", () => {
  // The last page of a two-page @react-pdf resume, as pdf.js reports it: a centred "SKILLS"
  // heading, then four short lines at the left margin, each a bold label, a colon and values.
  // No text crosses the strip between the lines' ends and the heading, but the heading sits above
  // the block, not beside it; read as a column of its own it came after its lines, and the
  // parser found an empty skills section.
  const item = (str: string, size: number, x: number, y: number, width: number) => ({
    str,
    transform: [size, 0, 0, size, x, y],
    width,
    height: str.trim() ? size : 0,
    hasEOL: false,
  });
  const row = (y: number, label: string, colon: number, values: string, width: number) => [
    { ...item("", 10.5, 24, y, 0), hasEOL: true },
    item(label, 10.5, 24, y, colon - 24),
    item(":", 10.5, colon, y, 3.3),
    item(" ", 10.5, colon + 3.2, y, 2.4),
    item(values, 10.5, colon + 5.6, y, width),
  ];
  const lastPage = [
    item("SKILLS", 9, 280.9, 787.5, 33.2),
    ...row(766.1, "Languages", 80.7, "TypeScript, JavaScript, SQL", 133.8),
    ...row(747.4, "Frontend", 70.3, "React, Next.js, Tailwind CSS", 133.8),
    ...row(728.6, "Backend", 68.8, "Node.js, Express, PostgreSQL", 141.2),
    ...row(709.9, "Other", 53.5, "System Design, Performance, UX Thinking", 199.8),
  ];
  const read = () => pageText(lastPage, (x, y) => [x, 841.5 - y], 595.5);

  it("reads the heading before the lines under it, and reports no second column", () => {
    const { text: extracted, columns } = read();
    expect(extracted.split("\n")).toEqual([
      "SKILLS",
      "Languages: TypeScript, JavaScript, SQL",
      "Frontend: React, Next.js, Tailwind CSS",
      "Backend: Node.js, Express, PostgreSQL",
      "Other: System Design, Performance, UX Thinking",
    ]);
    expect(columns).toBe(0);
  });

  it("finds the skills under it", () => {
    const resume = ["Jane Doe", "jane.doe@example.com | +1 415 555 0142", read().text].join("\n");
    const report = check(resume, DEFAULT_POLICY, { now: new Date("2026-10-01T00:00:00Z") });
    expect(report.parsed.skills).toEqual(
      expect.arrayContaining(["TypeScript", "React", "PostgreSQL", "System Design"]),
    );
  });

  it("is not a column with a centred footer under the block either", () => {
    const withFooter = [...lastPage, item("Page 2 of 2", 9, 276, 40, 45)];
    const { text: extracted, columns } = pageText(withFooter, (x, y) => [x, 841.5 - y], 595.5);
    expect(extracted.split("\n")[0]).toBe("SKILLS");
    expect(columns).toBe(0);
  });
});
