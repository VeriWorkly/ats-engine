/** What a tool call names (resume, posting, region), read as the `ats-engine` CLI reads it: same readers, limits, messages and policy. */

import { fork } from "node:child_process";
import { createRequire } from "node:module";
import { availableParallelism, homedir } from "node:os";
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
  type AtsExtractRequest,
  type AtsExtractResponse,
  type AtsJobFile,
  type AtsResumeFormat,
} from "@veriworkly/ats-engine/node";

/** The community policy with the bundled language and region packs, as the CLI scores. */
export const POLICY = withLocales(DEFAULT_POLICY, BUILT_IN_LOCALES);

export const REGIONS = POLICY.locales.regions.map((pack) => pack.id);
/** The policy's own language (English, read with no pack) and the bundled language packs. */
export const LANGUAGES = [POLICY.text.language, ...POLICY.locales.languages.map((pack) => pack.id)];

/** Pasted text longer than this is not a resume or a posting. */
export const MAX_TEXT_CHARS = 200_000;

/** A mistake in the call, reported to the assistant as a tool error in plain words. */
export class ToolInputError extends Error {}

const CHILD = createRequire(import.meta.url).resolve("@veriworkly/ats-engine/node/child");
/** The longest one PDF or DOCX may take to read before its process is stopped. */
const EXTRACT_TIMEOUT_MS = 60_000;

const cancelled = () => new AtsFileError("The call was cancelled.");

/**
 * Files read at once, each with the file in memory and a child reading it; further calls wait
 * their turn. 150 calls at once started 150 children (7.3 GB).
 */
export const MAX_READS = Math.max(1, availableParallelism());
let reading = 0;
const waiting: Array<() => void> = [];

/** Runs `read` in its turn: a call cancelled while it waits never starts. */
export async function inTurn<T>(read: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw cancelled();
  if (reading < MAX_READS) reading += 1;
  else
    await new Promise<void>((start, fail) => {
      const turn = () => {
        signal?.removeEventListener("abort", leave);
        start();
      };
      const leave = () => {
        waiting.splice(waiting.indexOf(turn), 1);
        fail(cancelled());
      };
      waiting.push(turn);
      signal?.addEventListener("abort", leave, { once: true });
    });
  try {
    return await read();
  } finally {
    // The turn passes straight to the next in line, so no new call takes it in between.
    const next = waiting.shift();
    if (next) next();
    else reading -= 1;
  }
}

/**
 * Reads a PDF or DOCX in its own `/node/child` process, so a file that exhausts memory, crashes
 * pdf.js or never ends takes down that process, not this server. Memory still needs an OS limit
 * (SECURITY.md). Cancelling the call (`signal`) stops the process.
 */
export function extractInChild(
  data: Uint8Array,
  format: AtsResumeFormat,
  signal?: AbortSignal,
): Promise<AtsExtraction> {
  return readInChild(data, format, false, signal);
}

/** A saved job posting page, read in a child as a resume is: a 19 MB page held this server 6 s. */
export function readJobPageInChild(data: Uint8Array, signal?: AbortSignal): Promise<AtsJobFile> {
  return readInChild(data, "html", true, signal);
}

function readInChild(
  data: Uint8Array,
  format: AtsResumeFormat,
  job: boolean,
  signal?: AbortSignal,
): Promise<AtsExtraction & AtsJobFile> {
  return new Promise((done, fail) => {
    if (signal?.aborted) return fail(cancelled());
    const child = fork(CHILD, [], { stdio: ["ignore", "ignore", "ignore", "ipc"] });
    const abort = () => stop(cancelled());
    signal?.addEventListener("abort", abort, { once: true });
    const stop = (error?: Error, result?: AtsExtraction & AtsJobFile) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
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
        ? stop(undefined, {
            text: answer.text,
            ...(answer.layout && { layout: answer.layout }),
            ...(answer.company && { company: answer.company }),
          })
        : stop(new AtsFileError(answer.message, answer.cause ? { cause: answer.cause } : {})),
    );
    child.on("error", (error) =>
      stop(new AtsFileError(`Could not read the file: ${error.message}`)),
    );
    child.on("exit", (code, signal) =>
      stop(new AtsFileError(`Reading the file stopped its process (${signal ?? `exit ${code}`}).`)),
    );
    const request: AtsExtractRequest = {
      id: 1,
      format,
      buffer: Buffer.from(data).toString("base64"),
      job,
    };
    child.send(request);
  });
}

/** Resolves `~/cv.pdf` and relative paths. */
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

/** The resume a call names, read from its file (in its turn) or taken from its text. */
export async function readResume(
  args: ResumeArgs,
  signal?: AbortSignal,
): Promise<{ input: AtsResumeInput; layout?: AtsLayoutSignals; file?: AtsFileInfo }> {
  exactlyOne(args.path, args.text, "resume", ["path", "text"]);
  const path = args.path;
  if (path !== undefined)
    return inTurn(
      () =>
        readResumeFile(absolute(path), {
          extract: (data, format) => extractInChild(data, format, signal),
        }),
      signal,
    );
  if (args.text === undefined)
    throw new ToolInputError(
      "Give the resume: path (a file on this computer) or text (the resume itself).",
    );
  // Normalised as a .txt file is, so pasted text scores as the file does.
  const text = normalizeExtractedText(args.text);
  if (text.length < 50)
    throw new ToolInputError("The text is too short to be a resume (under 50 characters).");
  return { input: text };
}

/** The posting a call names, or undefined when it names none. */
export async function readJob(
  args: JobArgs,
  signal?: AbortSignal,
): Promise<{ text: string; company?: string } | undefined> {
  exactlyOne(args.job_path, args.job_text, "job posting", ["job_path", "job_text"]);
  const path = args.job_path;
  const job =
    path !== undefined
      ? await inTurn(
          () =>
            readJobFile(absolute(path), {
              extract: (data, format) => extractInChild(data, format, signal),
              readJobPage: (data) => readJobPageInChild(data, signal),
            }),
          signal,
        )
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

export function checkLanguage(language: string | undefined): void {
  if (language !== undefined && !LANGUAGES.includes(language.toLowerCase()))
    throw new ToolInputError(`Unknown language "${language}"; use one of ${LANGUAGES.join(", ")}.`);
}

/** The applicant tracking systems the policy has documented notes on. */
export const TARGETS = Object.keys(POLICY.advice.targets);

export function checkTarget(target: string | undefined): void {
  if (target !== undefined && !TARGETS.includes(target.toLowerCase()))
    throw new ToolInputError(`Unknown target_ats "${target}"; use one of ${TARGETS.join(", ")}.`);
}

/** Whether an error's message is for the person (their mistake), not the server's. */
export function isUserError(error: unknown): boolean {
  return error instanceof ToolInputError || error instanceof AtsFileError;
}
