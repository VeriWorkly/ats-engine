/**
 * @veriworkly/ats-engine/node/child — an extraction process for a server to fork.
 *
 * Run it as a separate OS process, not a worker thread: worker threads share the parent's V8
 * process, and repeatedly spawning threads that load pdf.js segfaults Node (reproduced on
 * v24.18.0 within 2-5 spawns). A child process has its own heap, so both a crash and a forced
 * kill on timeout are contained, which is what makes a timeout on a pathological PDF mean
 * anything.
 *
 *   fork(createRequire(import.meta.url).resolve("@veriworkly/ats-engine/node/child"))
 *
 * Speaks the protocol in `./protocol.ts`. Compiled JavaScript, so the parent needs no
 * TypeScript loader to start it, in development or production.
 */

import { extractResume } from "./extract.js";
import { readJobPage } from "./files.js";
import type { AtsExtractRequest, AtsExtractResponse } from "./protocol.js";

/** "InvalidPDFException: Invalid PDF structure.": the reader's own words behind a message. */
const reasonOf = (cause: unknown) =>
  cause instanceof Error ? `${cause.name}: ${cause.message}` : undefined;

process.on("message", (request: AtsExtractRequest | null) => {
  void (async () => {
    // A malformed request is answered, not thrown on: a throw here would end the process.
    const id = typeof request?.id === "number" ? request.id : -1;
    let response: AtsExtractResponse;
    try {
      if (typeof request?.buffer !== "string") throw new Error("Invalid extraction request.");
      const data = Buffer.from(request.buffer, "base64");
      if (request.job) {
        if (request.format !== "html") throw new Error("Only an html job posting is read here.");
        response = { id, ok: true, ...readJobPage(data) };
      } else {
        const { text, layout } = await extractResume(data, request.format);
        response = { id, ok: true, text, layout };
      }
    } catch (error) {
      const cause = reasonOf((error as { cause?: unknown } | null)?.cause);
      response = {
        id,
        ok: false,
        message: error instanceof Error ? error.message : "Resume extraction failed",
        ...(cause && { cause }),
      };
    }
    process.send?.(response);
  })();
});

// Exit rather than linger if the parent goes away without killing us.
process.on("disconnect", () => process.exit(0));
