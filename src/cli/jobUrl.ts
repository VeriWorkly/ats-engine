/**
 * `--job-url`: a job posting read from its board's public JSON API, never from the page itself.
 *
 * The URL is the user's, but only its board and job id are used: the request goes to the fixed
 * API host the table below names for the posting's host, so a URL cannot point the CLI at a
 * machine of its choosing (a host on the local network, a cloud metadata address). A posting on
 * any other host is refused; the user saves the page and passes it with `--job`. This is the only
 * network request `check` makes without `--ai`, and it lives here so the core, `/job`, `/node`
 * and the MCP server stay free of any.
 */

import { decodeEntities } from "../job/html.js";
import { jobHtmlToText, normalizeJobText } from "../job/index.js";
import { MAX_FILE_BYTES, type AtsJobFile } from "../node/files.js";
import { UsageError } from "./usage.js";

/** A posting the board's API could not give: printed as one line, without a stack. */
export class JobUrlError extends Error {}

/** For a test to answer in the board's place; defaults to the global `fetch`. */
export type FetchJob = typeof fetch;

/** A posting's text, title and employer, as one board's API gives them. */
type Posting = { title: string; html: string[]; company?: string };

type Board = {
  /** The vendor, as `--ats` names it: its notes are added when the policy has some. */
  ats: string;
  /** Each posting host, with the API host asked in its place. */
  hosts: Readonly<Record<string, string>>;
  /** The board and the job id from a posting URL's path and query, or null. */
  locate(path: string[], query: URLSearchParams): [board: string, job: string] | null;
  api(host: string, board: string, job: string): string;
  /** The posting in the API's answer; "missing" when it lists others, null when it is no posting. */
  read(json: Record<string, unknown>, job: string): Posting | "missing" | null;
};

/**
 * A board's or a job's name in a path: letters, digits, `-`, `_` and `.`, starting with a letter
 * or a digit, so it can never be `..` or carry a `/`, `?` or `%` into the API's path.
 */
const NAME = /^[A-Za-z\d][\w.-]{0,99}$/;
const NUMBER = /^\d{1,20}$/;
// Any case in a link; Lever and Ashby list their ids in lowercase, so it is asked for so.
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

const text = (value: unknown) => (typeof value === "string" ? value : "");
const field = (value: unknown, name: string) =>
  value && typeof value === "object" ? (value as Record<string, unknown>)[name] : undefined;

/**
 * The job boards `--job-url` reads, each with its public, keyless posting API. A new board is a
 * new entry; its API host is the only host ever asked.
 */
const BOARDS: readonly Board[] = Object.freeze<Board[]>([
  {
    ats: "greenhouse",
    hosts: {
      "boards.greenhouse.io": "boards-api.greenhouse.io",
      "job-boards.greenhouse.io": "boards-api.greenhouse.io",
    },
    // `/{board}/jobs/{id}`, or `/{board}?gh_jid={id}`. A `gh_jid` on any other path (a company's
    // own careers page, Greenhouse's embed) does not say which board the job is on.
    locate([board, jobs, job, ...rest], query) {
      const id = jobs === undefined ? query.get("gh_jid") : jobs === "jobs" && !rest.length && job;
      return board && NAME.test(board) && id && NUMBER.test(id) ? [board, id] : null;
    },
    api: (host, board, job) => `https://${host}/v1/boards/${board}/jobs/${job}`,
    // `content` is the description's HTML, escaped once more, as JSON-LD's often is.
    read: (json) =>
      typeof json.content === "string"
        ? {
            title: text(json.title),
            html: [json.content.includes("&lt;") ? decodeEntities(json.content) : json.content],
            company: text(json.company_name),
          }
        : null,
  },
  {
    ats: "lever",
    hosts: { "jobs.lever.co": "api.lever.co", "jobs.eu.lever.co": "api.eu.lever.co" },
    // `/{site}/{id}`, or its form, `/{site}/{id}/apply`.
    locate: ([site, job, form, ...rest]) =>
      site &&
      NAME.test(site) &&
      job &&
      UUID.test(job) &&
      (form ?? "apply") === "apply" &&
      !rest.length
        ? [site, job.toLowerCase()]
        : null,
    api: (host, site, job) => `https://${host}/v0/postings/${site}/${job}`,
    // No employer: the API names none. The bullets are in `lists`, each under its heading.
    read: (json) =>
      typeof json.description === "string"
        ? {
            title: text(json.text),
            html: [
              json.description,
              ...(Array.isArray(json.lists) ? json.lists : []).map(
                (list) =>
                  `<h3>${text(field(list, "text"))}</h3><ul>${text(field(list, "content"))}</ul>`,
              ),
              text(json.additional),
            ],
          }
        : null,
  },
  {
    ats: "ashby",
    hosts: { "jobs.ashbyhq.com": "api.ashbyhq.com" },
    // `/{org}/{id}`, or its form, `/{org}/{id}/application`.
    locate: ([org, job, form, ...rest]) =>
      org &&
      NAME.test(org) &&
      job &&
      UUID.test(job) &&
      (form ?? "application") === "application" &&
      !rest.length
        ? [org, job.toLowerCase()]
        : null,
    // The API lists the board's jobs, descriptions included; it has no address for one job.
    api: (host, org) => `https://${host}/posting-api/job-board/${org}`,
    read(json, job) {
      if (!Array.isArray(json.jobs)) return null;
      // An unlisted job is not in the list either.
      const posting: unknown = json.jobs.find((item) => field(item, "id") === job);
      if (!posting) return "missing";
      const html = field(posting, "descriptionHtml");
      return typeof html === "string"
        ? { title: text(field(posting, "title")), html: [html] }
        : null;
    },
  },
]);

const NAMES = "Greenhouse, Lever or Ashby";
const label = (board: Board) => board.ats[0]!.toUpperCase() + board.ats.slice(1);
const notFound = (board: Board) =>
  new JobUrlError(
    `The ${label(board)} board has no job at that address: it may be closed or unlisted. If it is open, save the page and pass it with --job.`,
  );

/** The longest wait for the board's answer, body included. */
const TIMEOUT_MS = 20_000;

/** Where a posting URL's job is asked for, or a UsageError saying why it is not one. */
export function locateJob(address: string): { board: Board; api: string; job: string } {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    throw new UsageError(`--job-url "${address}" is not a web address.`);
  }
  if (url.protocol !== "https:")
    throw new UsageError(`--job-url takes only https: addresses, not ${url.protocol}.`);
  const board = BOARDS.find((entry) => Object.hasOwn(entry.hosts, url.hostname));
  if (!board)
    throw new UsageError(
      `--job-url reads ${NAMES} job postings only, not ${url.hostname}. Save the page and pass it with --job.`,
    );
  // Each segment decoded, so an encoded "/" or "." is checked as what it stands for.
  let path: string[];
  try {
    path = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch {
    path = [];
  }
  const found = board.locate(path, url.searchParams);
  if (!found)
    throw new UsageError(
      `--job-url ${url.origin}${url.pathname} is not a job posting's address on ${label(board)}.`,
    );
  const [name, job] = found;
  const api = board.api(
    board.hosts[url.hostname]!,
    encodeURIComponent(name),
    encodeURIComponent(job),
  );
  return { board, api, job };
}

/** The posting at a located address, as `readJobFile` gives a saved page. */
export async function fetchJob(
  { board, api, job }: ReturnType<typeof locateJob>,
  fetchImpl: FetchJob = globalThis.fetch,
): Promise<AtsJobFile> {
  const host = new URL(api).host;
  // Covers the body too: `fetch` aborts the stream it is reading when the signal fires.
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let raw: string;
  try {
    // Never followed: the API host is the only one asked, wherever it points.
    const response = await fetchImpl(api, {
      headers: { accept: "application/json" },
      redirect: "manual",
      signal,
    });
    const redirect = response.status >= 300 && response.status < 400;
    if (redirect || response.type === "opaqueredirect" || response.redirected)
      throw new JobUrlError(`${host} answered with a redirect, which is not followed.`);
    if (response.status === 404) throw notFound(board);
    if (!response.ok) throw new JobUrlError(`${host} answered HTTP ${response.status}.`);
    raw = await readCapped(response, host);
  } catch (error) {
    if (error instanceof JobUrlError) throw error;
    // Node says only "fetch failed"; what failed (DNS, TLS, a refused connection) is its cause.
    const failed = error as Error & { cause?: { code?: unknown } };
    const reason = typeof failed.cause?.code === "string" ? failed.cause.code : failed.message;
    throw new JobUrlError(
      signal.aborted
        ? `${host} did not answer within ${TIMEOUT_MS / 1000} s.`
        : `Could not reach ${host} (${reason}).`,
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new JobUrlError(`${host} answered with a body that is not JSON.`);
  }
  const posting =
    json && typeof json === "object" && !Array.isArray(json)
      ? board.read(json as Record<string, unknown>, job)
      : null;
  if (posting === "missing") throw notFound(board);
  if (!posting)
    throw new JobUrlError(`${host} answered with JSON that is not a ${label(board)} posting.`);
  // JSON-LD descriptions get the same reading (`extractJobPosting`): HTML to lines, then capped.
  const description = posting.html
    .map((html) => jobHtmlToText(html, Number.POSITIVE_INFINITY))
    .filter(Boolean);
  const jobText = normalizeJobText([posting.title, ...description].join("\n"));
  return posting.company ? { text: jobText, company: posting.company } : { text: jobText };
}

/**
 * The body as text, refused past the size a file may be: an API's answer is read into memory, so
 * an endless or huge one stops at the limit. A big Ashby board lists every job's description and
 * runs to megabytes.
 */
async function readCapped(response: Response, host: string): Promise<string> {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  const reader = response.body?.getReader();
  if (!reader) return "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_FILE_BYTES) {
      await reader.cancel();
      throw new JobUrlError(
        `${host} answered with over ${MAX_FILE_BYTES / 1024 / 1024} MB, which is not read.`,
      );
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
