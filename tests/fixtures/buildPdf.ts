/**
 * Minimal single-page PDF writer for layout-detection fixtures.
 *
 * Hand-built rather than checked in as binaries so the geometry under test is visible in the
 * test itself: the difference between the two-column and single-column cases is two numbers,
 * and a reviewer can see exactly what is being asserted without opening a PDF viewer.
 */
/**
 * `resources` is added to the page's resource dictionary, e.g. an inline `/ExtGState<<…>>`.
 * `info` is the body of the document Info dictionary, e.g. `/Keywords(…)`.
 * `extra` objects are numbered from 7 on, for resources that must be indirect: a form XObject,
 * an image XObject (`<</Type/XObject…>>\nstream\n…\nendstream`; see `stream`).
 */
export function buildPdf(
  contentStream: string,
  resources = "",
  info = "",
  extra: string[] = [],
  /** `page` is added to the page dictionary (e.g. `/Annots[7 0 R]`), `trailer` to the trailer. */
  { page = "", trailer = "" }: { page?: string; trailer?: string } = {},
): Buffer {
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    "<</Type/Pages/Kids[3 0 R]/Count 1>>",
    `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 4 0 R>>${resources}>>/Contents 5 0 R${page}>>`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    `<</Length ${Buffer.byteLength(contentStream, "latin1")}>>\nstream\n${contentStream}\nendstream`,
    `<<${info}>>`,
    ...extra,
  ];
  return assemble(objects, `/Info 6 0 R${trailer}`);
}

/** Numbered objects and the trailer's extra entries, as a PDF file. */
function assemble(objects: string[], trailer: string): Buffer {
  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefAt = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R${trailer}>>\nstartxref\n${xrefAt}\n%%EOF\n`;

  return Buffer.from(pdf, "latin1");
}

/** A PDF of several pages, one content stream each, all in Helvetica as `F1`. */
export function buildPdfPages(contentStreams: string[]): Buffer {
  const pages = contentStreams.map((_, index) => 4 + index * 2);
  const objects = [
    "<</Type/Catalog/Pages 2 0 R>>",
    `<</Type/Pages/Kids[${pages.map((page) => `${page} 0 R`).join(" ")}]/Count ${pages.length}>>`,
    "<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ...contentStreams.flatMap((content, index) => [
      `<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]/Resources<</Font<</F1 3 0 R>>>>/Contents ${pages[index]! + 1} 0 R>>`,
      `<</Length ${Buffer.byteLength(content, "latin1")}>>\nstream\n${content}\nendstream`,
    ]),
  ];
  return assemble(objects, "");
}

/** A stream object for `buildPdf`'s `extra`: `dictionary` without its `<<>>` or `/Length`. */
export function stream(dictionary: string, content: string) {
  return `<<${dictionary}/Length ${Buffer.byteLength(content, "latin1")}>>\nstream\n${content}\nendstream`;
}

/** One text-showing operator at an absolute page position, in points from the bottom left. */
export function text(x: number, y: number, value: string) {
  return `BT /F1 10 Tf ${x} ${y} Td (${value.replace(/([()\\])/g, "\\$1")}) Tj ET`;
}

export const LEFT_COLUMN = [
  "Automated nightly regression verification runs",
  "Owned the on call rotation for twelve services",
  "Cut median dashboard load from 3.2s to 900ms",
  "Introduced Terraform modules across all envs",
  "Jane Doe Senior Software Engineer",
  "Led migration of a monolith to 30 services",
  "Built CI CD pipelines with Kubernetes",
  "Designed a PostgreSQL sharding strategy",
  "Mentored five engineers over 18 months",
  "Developed a real time analytics service",
  "Reduced infrastructure cost by 310000",
  "Improved test coverage from 41 to 88",
];

export const RIGHT_COLUMN = [
  "Certifications and professional training",
  "Public speaking and conference talks",
  "Open source maintenance and reviews",
  "Volunteering and community mentoring",
  "Skills and Technologies listing",
  "Go TypeScript Python and Node",
  "React Redux and GraphQL clients",
  "PostgreSQL Redis and MongoDB",
  "Kubernetes Docker and Terraform",
  "Amazon Web Services and Azure",
  "Kafka RabbitMQ and streaming",
  "Education University of California",
];

/**
 * Page content as Chrome prints it: CSS pixels, y down, through `.75 0 0 -.75 0 792 cm`, so a
 * 1px border is a filled rectangle 0.75pt thick. `body` is drawn with `chromeRect` and
 * `chromeText`.
 */
export const chromePage = (...body: string[]) =>
  ["q .75 0 0 -.75 0 792 cm 0 0 0 rg", ...body, "Q"].join("\n");

/** A filled rectangle in CSS pixels, as Chrome paints a border edge or a background. */
export const chromeRect = (x: number, y: number, width: number, height: number) =>
  `${x} ${y} ${width} ${height} re f`;

/** Text at a CSS-pixel position (its baseline), upright through Chrome's flipped matrix. */
export function chromeText(x: number, y: number, value: string) {
  return `BT /F1 13.33 Tf 1 0 0 -1 ${x} ${y} Tm (${value.replace(/([()\\])/g, "\\$1")}) Tj ET`;
}

/**
 * A bordered HTML table (`border: 1px solid`) as Chrome prints it: every edge of every cell a
 * filled 1px rectangle, text in each cell. `collapse` is `border-collapse: collapse` (neighbours
 * share an edge); otherwise the default `separate`, a 2px gap between the cells' own borders
 * inside the table's border. `frames`: each box's border painted as Blink paints a uniform one,
 * a single frame, its outer rectangle with the inner cut out (`re re f*`), rather than four
 * edges. Positions are CSS pixels from the top left.
 */
export function chromeTable(
  rows: number,
  cols: number,
  { left = 80, top = 300, cellWidth = 220, cellHeight = 32, collapse = true, frames = false } = {},
) {
  const edges = (x: number, y: number, width: number, height: number) =>
    frames
      ? [`${x} ${y} ${width} ${height} re ${x + 1} ${y + 1} ${width - 2} ${height - 2} re f*`]
      : [
          chromeRect(x, y, width, 1),
          chromeRect(x, y + height - 1, width, 1),
          chromeRect(x, y, 1, height),
          chromeRect(x + width - 1, y, 1, height),
        ];
  const spacing = collapse ? 0 : 2;
  const inset = collapse ? 0 : 1 + spacing;
  const ops: string[] = [];
  if (!collapse)
    ops.push(
      ...edges(
        left,
        top,
        cols * (cellWidth + spacing) + spacing + 2,
        rows * (cellHeight + spacing) + spacing + 2,
      ),
    );
  for (let row = 0; row < rows; row += 1)
    for (let col = 0; col < cols; col += 1) {
      const x = left + inset + col * (cellWidth + spacing - (collapse ? 1 : 0));
      const y = top + inset + row * (cellHeight + spacing - (collapse ? 1 : 0));
      ops.push(
        ...edges(x, y, cellWidth, cellHeight),
        chromeText(x + 8, y + 21, `Cell ${row}${col}`),
      );
    }
  return ops.join("\n");
}

/** Draws a stroked `rows` x `cols` grid with text in every cell. */
export function ruledTable(rows: number, cols: number) {
  const [x0, y0, cellW, cellH] = [60, 380, 160, 40];
  const ops = ["0.5 w"];

  for (let row = 0; row <= rows; row += 1)
    ops.push(`${x0} ${y0 + row * cellH} m ${x0 + cols * cellW} ${y0 + row * cellH} l S`);
  for (let col = 0; col <= cols; col += 1)
    ops.push(`${x0 + col * cellW} ${y0} m ${x0 + col * cellW} ${y0 + rows * cellH} l S`);
  for (let row = 0; row < rows; row += 1)
    for (let col = 0; col < cols; col += 1)
      ops.push(
        text(x0 + col * cellW + 8, y0 + (rows - row - 1) * cellH + 15, `cell ${row}${col} value`),
      );

  return ops.join("\n");
}
