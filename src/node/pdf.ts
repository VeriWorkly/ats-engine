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
/** Pages with text whose visibility is measured; past this, hidden text is reported as not measured, never as clean. */
const MAX_VISIBILITY_PAGES = 60;
/** Pages read at most; the character cap does not bound empty pages. */
const MAX_PAGES_READ = 100;
/** Fewer text characters than this on a page with an image, and the page is a picture. */
const MIN_PAGE_TEXT = 20;
/** Fewer than this over an image across most of the page, and it is a picture: a scanner's one-line stamp. */
const STAMP_TEXT = 40;
/** Points a side (about 0.7in) an image must reach to count as a photo. */
const PHOTO_MIN = 50;

const ENCRYPTED = "The PDF is password-protected; remove the password and upload it again.";
const DAMAGED = "The file could not be read as a PDF; it may be damaged.";

/**
 * Where pdf.js finds the standard fonts and the CMaps CJK fonts are decoded through: a
 * file-system path (not a `file:` URL) with the trailing "/" pdf.js insists on.
 */
function pdfjsDirectory(name: "standard_fonts" | "cmaps") {
  const packageJson = createRequire(import.meta.url).resolve("pdfjs-dist/package.json");
  return `${join(dirname(packageJson), name)}/`;
}

/** What both pdf.js passes are given to find their files. */
const pdfjsFiles = () => ({
  standardFontDataUrl: pdfjsDirectory("standard_fonts"),
  cMapUrl: pdfjsDirectory("cmaps"),
  cMapPacked: true,
});

type PdfGeometry = Omit<AtsLayoutSignals, "tableCount">;

/**
 * A PDF's text and page geometry, in one pdf.js pass. The text is assembled in reading order
 * (`pageText`); reading stops once it passes `maxChars` or after `MAX_PAGES_READ` pages. Every page
 * whose text is read is measured too (columns, hidden text), so hidden text cannot sit past the
 * checked pages. pdf.js's errors become messages a person can act on, with the original as cause.
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
      ...pdfjsFiles(),
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

    const last = Math.min(document.numPages, MAX_PAGES_READ);
    for (let number = 1; number <= last && chars < maxChars; number += 1) {
      const page = await document.getPage(number);
      const viewport = page.getViewport({ scale: 1 });
      const toViewport = (x: number, y: number) => viewport.convertToViewportPoint(x, y);
      const { items } = await page.getTextContent();
      const textItems: PdfTextItem[] = items.flatMap((item) => ("str" in item ? [item] : []));
      let marks: Box[] = [];

      // Its own try: a page whose drawing operators cannot be replayed still has text and columns;
      // its hidden-text and image signals are left out, not reported as clean. A page past the
      // first few with no text can hide none, and is not replayed.
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
            // A loop, not `push(...)`: a spread of many runs overflows the stack.
            for (const run of seen.hidden) hidden.push(run);
            if (number <= MAX_PAGES_MEASURED) {
              tables += seen.tables;
              // A photo: at least PHOTO_MIN points a side, but not across most of the page (a scan or background).
              const [, , pageWidth, pageHeight] = page.view as Box;
              const wide = ([x0, y0, x1, y1]: Box) =>
                (x1 - x0) * (y1 - y0) >= pageWidth * pageHeight * 0.5;
              imageCount += seen.images.filter(
                (box) => box[2] - box[0] >= PHOTO_MIN && box[3] - box[1] >= PHOTO_MIN && !wide(box),
              ).length;
              // An image and next to no text is a scan; over a full-page image with invisible OCR
              // text, a line or two is a scanner's stamp, not the resume.
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
      chars += lines.lines.join(" ").length + 2;
      // The worst page wins: averaging would hide a two-column page.
      if (lines.columns !== null) columnRatio = Math.max(columnRatio ?? 0, lines.columns);
      page.cleanup();
    }

    const hiddenText = hidden.join(" ").replace(/\s+/g, " ").trim();

    // Description fields no reader sees, where an instruction to an AI can hide.
    let metadataText: string | undefined;
    // Encrypted yet opened without a password: an owner password. pdf.js names the security
    // handler only for an encrypted document.
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
          hiddenText: hiddenText.slice(0, MAX_HIDDEN_TEXT),
          // Every text item, hidden or not, is read into a line, so the text holds all hidden text.
          hiddenTextRead: hiddenText.slice(0, MAX_HIDDEN_TEXT),
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
  // pdf.js can detach the bytes it is handed, so each pass gets a copy. `new Uint8Array(…)`
  // copies; `.slice()` on a Node `Buffer` returns a view.
  const { text, geometry, tables: drawn } = await readPdf(new Uint8Array(data), maxChars);
  // Ruled tables are counted twice, the larger kept: from the stroked or filled rules the page
  // draws (a CSS border prints as a thin filled rectangle), and by pdf-parse (stroked only).
  // `maxImageSize: 0`: tables are rules, and images would be decoded in full.
  const parser = new PDFParse({
    data: new Uint8Array(data),
    maxImageSize: 0,
    isEvalSupported: false,
    ...pdfjsFiles(),
    verbosity: 0,
  });

  try {
    let tableCount = drawn;
    try {
      // The first pages only: every page costs minutes on a long upload.
      const tables = await parser.getTable({ first: MAX_PAGES_MEASURED });
      tableCount = Math.max(
        drawn,
        tables.pages.reduce((sum, page) => sum + page.tables.length, 0),
      );
    } catch {
      // The more fragile pass: the document keeps its text, with the table signal absent.
    }

    return { text, layout: { ...geometry, tableCount } };
  } finally {
    await parser.destroy();
  }
}
