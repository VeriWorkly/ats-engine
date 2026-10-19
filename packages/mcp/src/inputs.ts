/**
 * What a tool call names — a resume file or its text, a posting file or its text, a region — read
 * the way the `ats-engine` CLI reads it: the same file readers, limits and messages
 * (`@veriworkly/ats-engine/node`), the same policy with the bundled locale packs.
 */

import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { resolve } from "node:path";

import {
  DEFAULT_POLICY,
  type AtsFileInfo,
  type AtsLayoutSignals,
  type AtsResumeInput,
} from "@veriworkly/ats-engine";
import { normalizeJobText } from "@veriworkly/ats-engine/job";
import { BUILT_IN_LOCALES, withLocales } from "@veriworkly/ats-engine/locales";
import {
  AtsFileError,
  normalizeExtractedText,
  readJobFile,
  readResumeFile,
  type AtsExtraction,
  type AtsExtractResponse,
  type AtsResumeFormat,
} from "@veriworkly/ats-engine/node";

/** The community policy with the bundled language and region packs, as the CLI scores. */
export const POLICY = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);

export const REGIONS = POLICY.locales.regions.map((pack) => pack.id);

/** Pasted text longer than this is not a resume or a posting; the engine reads far less. */
export const MAX_TEXT_CHARS = 200_000;

/** A mistake in the call, reported to the assistant as a tool error in plain words. */
export class ToolInputError extends Error {}

const CHILD = createRequire(import.meta.url).resolve("@veriworkly/ats-engine/node/child");
/** The longest one PDF or DOCX may take to read before its process is stopped. */
const EXTRACT_TIMEOUT_MS = 60_000;

/**
 * Reads a PDF or DOCX in its own `/node/child` process, one per file: a file that runs out of
 * memory, crashes pdf.js or never ends takes down that process, not this server. Memory still
 * needs an OS limit (SECURITY.md); a process can only be stopped, not capped, from here.
 */
export function extractInChild(data: Uint8Array, format: AtsResumeFormat): Promise<AtsExtraction> {
  return new Promise((done, fail) => {
    const child = fork(CHILD, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const stop = (error?: Error, result?: AtsExtraction) => {
      clearTimeout(timer);
      child.removeAllListeners();
      child.kill();
      if (error) fail(error);
      else done(result!);
    };
    const timer = setTimeout(
      () =>
        stop(
          new AtsFileError(
            `Reading the file took longer than ${EXTRACT_TIMEOUT_MS / 1000} s and was stopped.`,
          ),
        ),
      EXTRACT_TIMEOUT_MS,
    );
    child.on("message", (answer: AtsExtractResponse) =>
      answer.ok
        ? stop(undefined, { text: answer.text, ...(answer.layout && { layout: answer.layout }) })
        : stop(new AtsFileError(answer.message)),
    );
    child.on("error", (error) =>
      stop(new AtsFileError(`Could not read the file: ${error.message}`)),
    );
    child.on("exit", (code, signal) =>
      stop(new AtsFileError(`Reading the file stopped its process (${signal ?? `exit ${code}`}).`)),
    );
    child.send({ id: 1, format, buffer: Buffer.from(data).toString("base64") });
  });
}

/** `~/cv.pdf` as a shell would read it; relative paths against the server's working directory. */
function absolute(path: string): string {
  const home = /^~(?=$|[/\\])/;
  return resolve(home.test(path) ? path.replace(home, homedir()) : path);
}

function exactlyOne(
  path: string | undefined,
  text: string | undefined,
  what: string,
  names: [string, string],
) {
  if (path !== undefined && text !== undefined)
    throw new ToolInputError(`Give the ${what} as ${names[0]} or as ${names[1]}, not both.`);
}

export type ResumeArgs = { path?: string; text?: string };
export type JobArgs = { job_path?: string; job_text?: string };

/** The resume a call names, read from its file or taken from its text. */
export async function readResume(
  args: ResumeArgs,
): Promise<{ input: AtsResumeInput; layout?: AtsLayoutSignals; file?: AtsFileInfo }> {
  exactlyOne(args.path, args.text, "resume", ["path", "text"]);
  if (args.path !== undefined)
    return readResumeFile(absolute(args.path), { extract: extractInChild });
  if (args.text === undefined)
    throw new ToolInputError(
      "Give the resume: path (a file on this computer) or text (the resume itself).",
    );
  // Normalised as a .txt file's text is, so pasting a file's contents scores as the file does.
  const text = normalizeExtractedText(args.text);
  if (text.length < 50)
    throw new ToolInputError("The text is too short to be a resume (under 50 characters).");
  return { input: text };
}

/** The posting a call names, or undefined when it names none. */
export async function readJob(
  args: JobArgs,
): Promise<{ text: string; company?: string } | undefined> {
  exactlyOne(args.job_path, args.job_text, "job posting", ["job_path", "job_text"]);
  const job =
    args.job_path !== undefined
      ? await readJobFile(absolute(args.job_path), { extract: extractInChild })
      : args.job_text !== undefined
        ? { text: normalizeJobText(args.job_text) }
        : undefined;
  if (job !== undefined && !job.text.trim())
    throw new ToolInputError("The job posting has no readable text.");
  return job;
}

export function checkRegion(region: string | undefined): void {
  if (region !== undefined && !REGIONS.includes(region.toUpperCase()))
    throw new ToolInputError(`Unknown region "${region}"; use one of ${REGIONS.join(", ")}.`);
}

/** The applicant tracking systems the policy has documented notes on. */
export const TARGETS = Object.keys(POLICY.advice.targets);

export function checkTarget(target: string | undefined): void {
  if (target !== undefined && !TARGETS.includes(target.toLowerCase()))
    throw new ToolInputError(`Unknown target_ats "${target}"; use one of ${TARGETS.join(", ")}.`);
}

/** Whether an error's message is meant for the person: their mistake, not the server's. */
export function isUserError(error: unknown): boolean {
  return error instanceof ToolInputError || error instanceof AtsFileError;
}
