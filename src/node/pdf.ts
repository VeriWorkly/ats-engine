import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { AtsLayoutSignals } from "../types.js";
import { MAX_HIDDEN_TEXT } from "./docx.js";
import { measureVisibility, seeThroughImages } from "./hidden.js";
import type { Box } from "./surroundings.js";
import { joinPages, pageText, withLinks, type PdfTextItem } from "./lines.js";
import { optional } from "./peer.js";

/** Pages whose pictures and ruled tables are counted, here and by pdf-parse. */
const MAX_PAGES_MEASURED = 6;
/**
 * Pages with text whose visibility is measured. Every page whose text is read is measured up to
 * this; a document with text on more pages than this reports its hidden text as not measured,
 * never as clean.
 */
const MAX_VISIBILITY_PAGES = 60;
/** Fewer text characters than this on a page with an image, and the page is a picture. */
const MIN_PAGE_TEXT = 20;
/**
 * Fewer than this over an image across most of the page, and the page is a picture: a scanner's
 * one-line stamp ("Scanned with CamScanner"), not two short sections on a designed template's
 * background.
 */
const STAMP_TEXT = 40;
/** Points a side (about 0.7in) an image must reach to count as a photo. */
const PHOTO_MIN = 50;

const ENCRYPTED = "The PDF is password-protected; remove the password and upload it again.";
const DAMAGED = "The file could not be read as a PDF; it may be damaged.";

/**
 * Where pdf.js finds the standard 14 fonts' data. On Node it reads this with `fs.readFile`, so it
 * is a file-system path, not a `file:` URL — which `readFile` takes as a relative path, failing
 * (and warning) once per font of every such PDF. pdf.js insists on a trailing "/", which `fs`
 * accepts on Windows as well.
 */
function standardFontsDirectory() {
  const packageJson = createRequire(import.meta.url).resolve("pdfjs-dist/package.json");
  return `${join(dirname(packageJson), "standard_fonts")}/`;
}

type PdfGeometry = Omit<AtsLayoutSignals, "tableCount">;

/**
 * A PDF's text and page geometry, in one pdf.js pass.
 *
 * The text is assembled here (`pageText`), in reading order, rather than by pdf-parse. Reading
 * stops once the text passes `maxChars`, so a thousand-page upload costs what a resume does.
 * Every page whose text is read is measured too — its columns, and what of its text a reader
 * cannot see — so hidden text cannot sit past the pages that are checked. A link whose visible
 * text is "LinkedIn" is read for its target, which follows the text when the text lacks it.
 *
 * pdf.js's own errors ("No password given", "Invalid PDF structure.") become messages a person
 * can act on, with the original as the cause.
 */
async function readPdf(
  data: Uint8Array,
  maxChars: number,
): Promise<{ text: string; geometry: PdfGeometry; tables: number }> {
  const pdfjs = await optional(() => import("pdfjs-dist/legacy/build/pdf.mjs"), "pdfjs-dist");
  const ops = pdfjs.OPS as unknown as Record<string, number>;
  const document = await pdfjs
    .getDocument({
      data,
      isEvalSupported: false,
      standardFontDataUrl: standardFontsDirectory(),
      verbosity: 0,
    })
    .promise.catch((cause: unknown) => {
      const name = (cause as { name?: unknown } | null)?.name;
      throw new Error(name === "PasswordException" ? ENCRYPTED : DAMAGED, { cause });
    });

  try {
    let chars = 0;
    const pages: Array<{ lines: string[]; ys: number[] }> = [];
    let columnRatio: number | null = null;
    const hidden: string[] = [];
    const links: string[] = [];
    let imageOnlyPages = 0;
    let imageCount = 0;
    let tables = 0;
    let visibilityRead = true;
    let measured = 0;

    for (let number = 1; number <= document.numPages && chars < maxChars; number += 1) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const toViewport = (x: number, y: number) => viewport.convertToViewportPoint(x, y);
      const { items } = await page.getTextContent();
      const textItems: PdfTextItem[] = items.flatMap((item) => ("str" in item ? [item] : []));
      let marks: Box[] = [];

      // What a reader sees of the page's text. Its own try: a page whose drawing operators
      // cannot be replayed still has text and columns, and the hidden-text and image signals
      // are then left out rather than reported as clean. A page past the first few with no text
      // can hide none, and is not replayed.
      const hasText = textItems.some((item) => item.str.trim());
      if (number <= MAX_PAGES_MEASURED || hasText)
        if (++measured > MAX_VISIBILITY_PAGES) visibilityRead = false;
        else
          try {
            const list = (await page.getOperatorList()) as unknown as Parameters<
              typeof measureVisibility
            >[1];
            // A masked image covers what is under it unless its pixels let it show through.
            const seen = measureVisibility(
              ops,
              list,
              page.view as Box,
              await seeThroughImages(
                ops,
                list,
                page as unknown as Parameters<typeof seeThroughImages>[2],
              ),
            );
            // A loop, not `push(...)`: a spread of a few hundred thousand runs overflows the
            // stack, and this catch would then report the page's hidden text as unmeasured.
            for (const run of seen.hidden) hidden.push(run);
            if (number <= MAX_PAGES_MEASURED) {
              tables += seen.tables;
              // A photo: an image printed at least PHOTO_MIN points a side (icons and logo marks
              // are smaller) but not across most of the page, which is a scan or a background.
              const [, , pageWidth, pageHeight] = page.view as Box;
              const wide = ([x0, y0, x1, y1]: Box) =>
                (x1 - x0) * (y1 - y0) >= pageWidth * pageHeight * 0.5;
              imageCount += seen.images.filter(
                (box) => box[2] - box[0] >= PHOTO_MIN && box[3] - box[1] >= PHOTO_MIN && !wide(box),
              ).length;
              // An image and next to no text: a scan with no OCR layer, or a page saved as a
              // picture. Over an image across most of the page with no OCR layer (text drawn
              // invisibly), a line or two is a scanner's stamp ("Scanned with CamScanner"), not
              // the resume's text.
              const stamped = seen.images.some(wide) && seen.invisibleChars < MIN_PAGE_TEXT;
              if (seen.images.length && seen.textChars < (stamped ? STAMP_TEXT : MIN_PAGE_TEXT))
                imageOnlyPages += 1;
            }
            marks = seen.marks.map(([x0, y0, x1, y1]) => {
              const [[a, b], [c, d]] = [toViewport(x0, y0), toViewport(x1, y1)];
              return [Math.min(a, c), Math.min(b, d), Math.max(a, c), Math.max(b, d)];
            });
          } catch {
            visibilityRead = false;
          }

      try {
        for (const annotation of await page.getAnnotations())
          if (typeof annotation?.url === "string") links.push(annotation.url);
      } catch {
        // A page whose annotations cannot be read still has its text.
      }

      const lines = pageText(textItems, toViewport, viewport.width, marks);
      pages.push(lines);
      chars += lines.text.length + 2;
      // The worst page wins: one two-column page is a two-column resume, and averaging it
      // against clean pages would hide exactly the problem worth reporting.
      if (lines.columns !== null) columnRatio = Math.max(columnRatio ?? 0, lines.columns);
      page.cleanup();
    }

    const hiddenText = hidden.join(" ").replace(/\s+/g, " ").trim();

    // The document's own description fields, which no reader sees and an instruction to an AI
    // can hide in. Read for that alone: an ATS does not index them.
    let metadataText: string | undefined;
    // Encrypted, yet opened without a password: an owner password restricts the file. pdf.js
    // names the security handler only for an encrypted document.
    let encrypted = false;
    try {
      const info = (await document.getMetadata()).info as Record<string, unknown> | undefined;
      encrypted = typeof info?.EncryptFilterName === "string";
      metadataText = ["Title", "Subject", "Keywords", "Author"]
        .map((field) => info?.[field])
        .filter((value): value is string => typeof value === "string" && value.trim() !== "")
        .join("\n")
        .slice(0, 2_000);
    } catch {
      // No metadata to read is no finding.
    }

    return {
      tables,
      text: withLinks(joinPages(pages), links),
      geometry: {
        ...(metadataText && { metadataText }),
        ...(encrypted && { encrypted }),
        columnRatio,
        pageCount: document.numPages,
        ...(visibilityRead && {
          hiddenTextChars: hiddenText.replace(/\s/g, "").length,
          hiddenTextSample: hiddenText.slice(0, 80),
          hiddenText: hiddenText.slice(0, MAX_HIDDEN_TEXT),
          imageOnlyPages,
          imageCount,
        }),
      },
    };
  } catch (cause) {
    throw new Error(DAMAGED, { cause });
  } finally {
    await document.destroy();
  }
}

/** A PDF's text, its geometry and its ruled tables. Needs `pdf-parse` and `pdfjs-dist`. */
export async function extractPdf(
  data: Uint8Array,
  maxChars: number,
): Promise<{ text: string; layout: AtsLayoutSignals }> {
  const { PDFParse } = await optional(() => import("pdf-parse"), "pdf-parse and pdfjs-dist");
  // pdf.js can take ownership of (detach) the bytes it is handed, so each of the two passes gets
  // its own copy. `new Uint8Array(…)` always copies; `.slice()` would not on a Node `Buffer`,
  // where it returns a view of the same memory.
  const { text, geometry, tables: drawn } = await readPdf(new Uint8Array(data), maxChars);
  // Ruled tables are counted twice and the larger count kept: from the rules the page draws,
  // stroked or filled (a browser prints a CSS border as a thin filled rectangle), and by
  // pdf-parse, which reads stroked rules only but joins them its own way.
  const parser = new PDFParse({ data: new Uint8Array(data), verbosity: 0 });

  try {
    let tableCount = drawn;
    try {
      // The first pages only: every page cost a 1 500-page upload minutes, and a table count no
      // resume would have.
      const tables = await parser.getTable({ first: MAX_PAGES_MEASURED });
      tableCount = Math.max(
        drawn,
        tables.pages.reduce((sum, page) => sum + page.tables.length, 0),
      );
    } catch {
      // Table detection walks vector drawing operators and is the more fragile of the two
      // passes. A document it cannot analyse still has perfectly good text, so extraction
      // succeeds with the table signal simply absent rather than failing the upload.
    }

    return { text, layout: { ...geometry, tableCount } };
  } finally {
    await parser.destroy();
  }
}
