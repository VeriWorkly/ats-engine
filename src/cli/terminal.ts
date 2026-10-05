/**
 * Colour and the banner, for people reading the CLI in a terminal.
 *
 * Colour follows the usual conventions: `NO_COLOR` turns it off, `FORCE_COLOR` turns it on (into
 * a pipe too), and otherwise it is on only when the terminal reports colour. The banner goes only
 * to an interactive terminal outside CI, so a script, a pipe or a CI log reads exactly the plain
 * text it always did.
 */

import { ENGINE_VERSION } from "../version.js";

/** Bits of colour: 1 is none, 4 the basic sixteen, 8 the 256-colour palette, 24 true colour. */
export type ColorDepth = 1 | 4 | 8 | 24;

export type Terminal = {
  depth: ColorDepth;
  /** A person is watching: the banner is printed. */
  interactive: boolean;
  /** Width in columns, 80 when the stream does not say. */
  columns: number;
};

/** The part of `tty.WriteStream` this module reads; a pipe or a file has only `isTTY: false`. */
export type OutputStream = {
  isTTY?: boolean;
  columns?: number;
  getColorDepth?(env?: object): number;
};

export type Env = Readonly<Record<string, string | undefined>>;

/** Plain text, no banner: what a pipe gets, and what tests compare against. */
export const PLAIN: Terminal = { depth: 1, interactive: false, columns: 80 };

export function colorDepth(stream: OutputStream, env: Env): ColorDepth {
  // no-color.org: any non-empty value disables colour, and wins over everything else.
  if (env.NO_COLOR) return 1;
  const force = env.FORCE_COLOR;
  if (force !== undefined) {
    if (force === "0" || force === "false") return 1;
    return force === "3" ? 24 : force === "2" ? 8 : 4;
  }
  if (stream.isTTY !== true || !stream.getColorDepth) return 1;
  const depth = stream.getColorDepth(env);
  return depth >= 24 ? 24 : depth >= 8 ? 8 : depth >= 4 ? 4 : 1;
}

export function detectTerminal(stream: OutputStream, env: Env): Terminal {
  return {
    depth: colorDepth(stream, env),
    // CI services set CI=true; "false" or "0" is someone saying this is not CI.
    interactive: stream.isTTY === true && (!env.CI || /^(?:false|0)$/i.test(env.CI)),
    columns: stream.columns || 80,
  };
}

/**
 * Control characters, which text from a resume, a posting or a model can carry: an escape
 * sequence printed raw recolours the terminal, clears it, or sets its title. Line breaks and tabs
 * stay.
 */
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g; // eslint-disable-line no-control-regex

/** Every string in `value` made safe to print, at any depth. */
export function printable<T>(value: T): T {
  if (typeof value === "string") return value.replace(CONTROLS, "") as T;
  if (Array.isArray(value)) return value.map(printable) as T;
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, printable(child)]),
    ) as T;
  return value;
}

export type Style = Record<
  "bold" | "dim" | "red" | "green" | "yellow" | "accent",
  (text: string) => string
>;

/** VeriWorkly's accent blue (#60a5fa), at each colour depth. */
const ACCENT: Record<Exclude<ColorDepth, 1>, string> = {
  4: "94",
  8: "38;5;75",
  24: "38;2;96;165;250",
};

export function createStyle(depth: ColorDepth): Style {
  const sgr = (open: string, close: string) => (text: string) =>
    depth === 1 || !text ? text : `\x1b[${open}m${text}\x1b[${close}m`;
  return {
    bold: sgr("1", "22"),
    dim: sgr("2", "22"),
    red: sgr("31", "39"),
    green: sgr("32", "39"),
    yellow: sgr("33", "39"),
    accent: depth === 1 ? (text) => text : sgr(ACCENT[depth], "39"),
  };
}

const LETTERS: Record<string, readonly string[]> = {
  V: ["██╗   ██╗", "██║   ██║", "██║   ██║", "╚██╗ ██╔╝", " ╚████╔╝ ", "  ╚═══╝  "],
  E: ["███████╗", "██╔════╝", "█████╗  ", "██╔══╝  ", "███████╗", "╚══════╝"],
  R: ["██████╗ ", "██╔══██╗", "██████╔╝", "██╔══██╗", "██║  ██║", "╚═╝  ╚═╝"],
  I: ["██╗", "██║", "██║", "██║", "██║", "╚═╝"],
  W: ["██╗    ██╗", "██║    ██║", "██║ █╗ ██║", "██║███╗██║", "╚███╔███╔╝", " ╚══╝╚══╝ "],
  O: [" ██████╗ ", "██╔═══██╗", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝ "],
  K: ["██╗  ██╗", "██║ ██╔╝", "█████╔╝ ", "██╔═██╗ ", "██║  ██╗", "╚═╝  ╚═╝"],
  L: ["██╗     ", "██║     ", "██║     ", "██║     ", "███████╗", "╚══════╝"],
  Y: ["██╗   ██╗", "╚██╗ ██╔╝", " ╚████╔╝ ", "  ╚██╔╝  ", "   ██║   ", "   ╚═╝   "],
};

const WORDMARK = [0, 1, 2, 3, 4, 5].map((row) =>
  [..."VERIWORKLY"]
    .map((letter) => LETTERS[letter]![row])
    .join("")
    .trimEnd(),
);
const WORDMARK_WIDTH = Math.max(...WORDMARK.map((line) => line.length));

/** Top to bottom, from the accent's light end (#60a5fa) to its dark end (#2563eb). */
function gradient(depth: ColorDepth, row: number): string {
  if (depth === 24) {
    const t = row / (WORDMARK.length - 1);
    const mix = (from: number, to: number) => Math.round(from + (to - from) * t);
    return `38;2;${mix(96, 37)};${mix(165, 99)};${mix(250, 235)}`;
  }
  if (depth === 8) return `38;5;${[75, 75, 69, 69, 33, 33][row]}`;
  return "94";
}

/**
 * The VERIWORKLY wordmark with a tagline, or a single line when the terminal is too narrow for
 * the 80-column wordmark. A terminal exactly 80 wide gets the single line: some consoles wrap a
 * line that fills the last column, which would break every row of the wordmark in two.
 */
export function banner(terminal: Terminal): string {
  const style = createStyle(terminal.depth);
  const tagline = `ATS Engine v${ENGINE_VERSION} · see your resume the way an ATS reads it`;
  if (terminal.columns <= WORDMARK_WIDTH)
    return `${style.bold(style.accent("VERIWORKLY"))}  ${style.dim(`ATS Engine v${ENGINE_VERSION}`)}\n`;

  const art = WORDMARK.map((line, row) =>
    terminal.depth === 1 ? line : `\x1b[${gradient(terminal.depth, row)}m${line}\x1b[39m`,
  );
  return [...art, `  ${style.dim(tagline)} · ${style.accent("veriworkly.com")}`, ""].join("\n");
}
