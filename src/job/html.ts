/**
 * The visible text of an HTML page, by forward scans with `indexOf` — never a backtracking regex
 * over the page: the input is a page someone else wrote, up to megabytes long, and a pattern like
 * `<[^>]+>` is quadratic on a page of unclosed `<` — 40 KB of them took 660 ms, so a 2 MB page
 * would hold a server worker for the better part of an hour.
 *
 * Internal: `/job` normalises this into posting text, and the DOCX reader keeps its tabs.
 */

import { own } from "../util/own.js";

/**
 * Named entities: the Latin-1 range and the punctuation, currency and arrows postings use. Names
 * are case-sensitive ("Eacute" is not "eacute"). A letter with an accent ("uuml", "Eacute",
 * "scaron") is composed from the letter and the accent rather than listed.
 */
const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
// U+00A0 to U+00BF, in order; "nbsp" is read as a plain space.
"nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest"
  .split(" ")
  .forEach((name, at) => (ENTITIES[name] = String.fromCharCode(at ? 160 + at : 32)));
"AElig 198 ETH 208 times 215 Oslash 216 THORN 222 szlig 223 aelig 230 eth 240 divide 247 oslash 248 thorn 254 OElig 338 oelig 339 ensp 8194 emsp 8195 ndash 8211 mdash 8212 lsquo 8216 rsquo 8217 ldquo 8220 rdquo 8221 bull 8226 hellip 8230 euro 8364 trade 8482 rarr 8594 minus 8722"
  .split(" ")
  .forEach((name, at, all) => {
    if (at % 2 === 0) ENTITIES[name] = String.fromCharCode(Number(all[at + 1]));
  });

/** A letter and the combining mark each accent name stands for. */
const ACCENTED = /^([A-Za-z])(grave|acute|circ|tilde|uml|ring|caron|cedil)$/;
const ACCENTS: Record<string, number> = {
  grave: 768,
  acute: 769,
  circ: 770,
  tilde: 771,
  uml: 776,
  ring: 778,
  caron: 780,
  cedil: 807,
};

/** Bounded entity pattern: at most 10 characters between `&` and `;`, so it cannot backtrack. */
const ENTITY = /&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z][a-z0-9]{1,7});/gi;

export function decodeEntities(text: string): string {
  return text.replace(ENTITY, (match, body: string) => {
    if (body[0] !== "#") {
      const [, letter, accent] = ACCENTED.exec(body) ?? [];
      const composed = accent && (letter + String.fromCharCode(ACCENTS[accent]!)).normalize();
      if (composed && composed.length === 1) return composed;
      return own(ENTITIES, body) ?? own(ENTITIES, body.toLowerCase()) ?? match;
    }
    const code =
      body[1] === "x" || body[1] === "X" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

/** Elements whose content is never visible text. */
const HIDDEN = new Set(["script", "style", "noscript", "template", "svg", "head", "title"]);

/**
 * A page's furniture rather than its posting: navigation, sidebars, forms and their controls,
 * dialogs. `header` and `footer` too, unless the text was narrowed to `main` or `article`,
 * where they hold the posting's own title.
 */
const CHROME = new Set("nav aside form select button dialog".split(" "));
/**
 * An attribute, as `name=value` lowercased without whitespace, that hides its element or marks
 * it as page furniture: `hidden`, `aria-hidden="true"`, an inline `display: none`, an ARIA role
 * of furniture, an `id` or `class` naming a cookie banner or a list of other jobs. Anchored, and
 * each `.*` is followed by literals only, so it stays linear.
 */
const CHROME_ATTRIBUTE =
  /^(?:hidden=|aria-hidden=true$|role=(?:navigation|banner|contentinfo|complementary|dialog|alertdialog|search)$|(?:id|class)=.*(?:cookie|consent|gdpr|similar|related)|style=.*(?:display:none|visibility:hidden))/;

/**
 * Phrasing elements: they style a run of text without breaking it, so where text touches them
 * they become nothing — "Node<span>.js</span>" is "Node.js", "<b>Type</b>Script" is
 * "TypeScript", "C<sup>++</sup>" is "C++". Between two sibling elements, and for any other tag
 * that is not a block, they are a space.
 */
const INLINE = new Set(
  "a abbr b bdi bdo cite code del dfn em font i ins kbd mark q s samp small span strike strong sub sup time tt u var wbr".split(
    " ",
  ),
);

/** Tags that end a line of visible text. */
const BLOCK = new Set(
  "address article aside blockquote br dd div dl dt footer form h1 h2 h3 h4 h5 h6 header hr li main nav ol p pre section table td th tr ul".split(
    " ",
  ),
);

/** Anchored with one bounded run, so it cannot backtrack. */
const TAG_NAME = /^<\/?([a-z0-9]+)/i;

const tagName = (tag: string) => TAG_NAME.exec(tag)?.[1]?.toLowerCase() ?? "";

const asciiLower = (code: number) => (code >= 65 && code <= 90 ? code + 32 : code);

/**
 * `indexOf` ignoring ASCII case, searching the original string.
 *
 * Lowercasing the page and searching the copy is wrong: `toLowerCase` can change a string's
 * length ("İ" lowercases to two code units), so a position found in the copy points somewhere
 * else in the original. `needle` must be ASCII and is short, so this stays linear in practice.
 */
export function indexOfIgnoreCase(
  haystack: string,
  needle: string,
  from: number,
  before = haystack.length,
): number {
  const target = Array.from(needle, (char) => asciiLower(char.charCodeAt(0)));
  const last = Math.min(haystack.length - target.length, before - 1);
  for (let at = from; at <= last; at += 1) {
    let matched = 0;
    while (
      matched < target.length &&
      asciiLower(haystack.charCodeAt(at + matched)) === target[matched]
    )
      matched += 1;
    if (matched === target.length) return at;
  }
  return -1;
}

/** HTML opens a tag only when `<` is followed by a letter, `/`, `!` or `?`; otherwise it is text. */
function opensTag(html: string, at: number): boolean {
  const next = asciiLower(html.charCodeAt(at + 1));
  return (next >= 97 && next <= 122) || next === 47 || next === 33 || next === 63;
}

const isSpace = (char: string | undefined) =>
  char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";

/**
 * The `>` that ends the tag opened at `open`, or -1. A quoted attribute value may hold a `>`
 * (`<img alt="a > b">`), so one is skipped whole, as a browser does; a quote opens a value only
 * right after `=`. One forward pass: each character is looked at once.
 */
function tagEnd(html: string, open: number): number {
  for (let at = open + 1; at < html.length; at += 1) {
    const char = html[at];
    if (char === ">") return at;
    if (char !== "=") continue;
    let value = at + 1;
    while (isSpace(html[value])) value += 1;
    const quote = html[value];
    if (quote === '"' || quote === "'") {
      at = html.indexOf(quote, value + 1);
      if (at === -1) return -1;
    } else at = value - 1;
  }
  return -1;
}

/** Where `<name` or `</name` (`prefix`) next opens a tag of exactly that name, or -1. */
function findTag(html: string, prefix: string, from: number, before?: number): number {
  for (let at = indexOfIgnoreCase(html, prefix, from, before); at !== -1;) {
    if (!/[\w:-]/.test(html[at + prefix.length] ?? "")) return at;
    at = indexOfIgnoreCase(html, prefix, at + 1, before);
  }
  return -1;
}

/**
 * Past the end of the `name` element whose start tag ends before `from`: elements of the same
 * name inside it are counted, so an `<svg>` nested in another does not end the outer one early.
 * One that never closes runs to the end. Linear: each search is bounded by the next close tag.
 */
function skipElement(html: string, name: string, from: number): number {
  let depth = 1;
  let at = from;
  for (;;) {
    const close = findTag(html, `</${name}`, at);
    if (close === -1) return html.length;
    // Opens are looked for only up to the close: a search past it, for a name that never opens
    // again, cost the rest of the page on every element skipped.
    for (let open = findTag(html, `<${name}`, at, close); open !== -1;) {
      depth += 1;
      open = findTag(html, `<${name}`, open + 1, close);
    }
    depth -= 1;
    if (!depth) return html.indexOf(">", close) + 1 || html.length;
    at = close + 1;
  }
}

/** Each attribute of a tag, name and value; one forward pass, each match consuming input. */
const ATTRIBUTE = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/** Whether a start tag's attributes hide its element, or mark it as page furniture. */
function hiddenByAttributes(tag: string): boolean {
  return [...tag.slice(1 + tagName(tag).length).matchAll(ATTRIBUTE)].some(([, name, ...values]) =>
    CHROME_ATTRIBUTE.test(
      `${name}=${values.find((part) => part !== undefined) ?? ""}`.toLowerCase().replace(/\s/g, ""),
    ),
  );
}

/** Elements that have no end tag: hiding one hides nothing after it. */
const VOID = new Set("br hr img input meta link".split(" "));

/**
 * The visible text of an HTML document or fragment, one line per block, entities decoded and
 * whitespace as the page had it.
 *
 * Block elements become line breaks, so headings and bullets survive as lines instead of
 * collapsing into one paragraph; phrasing elements (`b`, `span`, `sup`, …) join the text
 * around them. Script, style, the document's head and similar elements are dropped with their
 * content; an element left unclosed drops everything after it, which on a well-formed page never
 * happens and on a hostile one is the safe direction. A `<` that cannot open a tag ("<5k") is
 * text, as it is to a browser.
 *
 * `page`: the input is a whole web page, read for the posting on it. The text is narrowed to its
 * `<main>` (or its one `<article>`) when it has one, and navigation, sidebars, forms, dialogs,
 * cookie banners, "similar jobs" lists and elements hidden by `hidden`, `aria-hidden` or an
 * inline `display: none` are dropped.
 */
export function htmlText(html: string, page = false): string {
  let chrome = new Set([...CHROME, "header", "footer"]);
  if (page)
    for (const name of ["main", "article"]) {
      const start = findTag(html, `<${name}`, 0);
      if (start === -1) continue;
      html = html.slice(start, skipElement(html, name, start + 1));
      chrome = CHROME;
      break;
    }
  const out: string[] = [];
  let index = 0;

  // Where the text since the last tag began.
  let text = 0;
  while (index < html.length) {
    const open = html.indexOf("<", index);
    if (open === -1) {
      out.push(html.slice(index));
      break;
    }
    out.push(html.slice(index, open));

    if (!opensTag(html, open)) {
      out.push("<");
      index = open + 1;
      continue;
    }

    if (html.startsWith("<!--", open)) {
      const close = html.indexOf("-->", open + 4);
      index = close === -1 ? html.length : close + 3;
      continue;
    }

    const close = tagEnd(html, open);
    if (close === -1) break; // an unclosed tag: nothing after it is renderable text
    const tag = html.slice(open, close + 1);
    const name = tagName(tag);
    const starts = html[open + 1] !== "/";
    index = close + 1;

    if (
      starts &&
      (HIDDEN.has(name) ||
        (page &&
          (chrome.has(name) || (/\s/.test(tag) && !VOID.has(name) && hiddenByAttributes(tag)))))
    ) {
      if (!tag.endsWith("/>")) index = skipElement(html, name, index);
      continue;
    }
    // A list item keeps its marker, so it reads as the bullet it is — to a resume's content
    // rules, and to a posting's heading detection, which must not take an item for a heading.
    // A phrasing tag that text touches joins it; between two sibling elements — skill tags,
    // "<span>Spark</span><span>Kafka</span>" — it is still a space.
    if (name === "li" && starts) out.push("\n• ");
    else out.push(BLOCK.has(name) ? "\n" : INLINE.has(name) && open > text ? "" : " ");
    text = index;
  }

  return decodeEntities(out.join(""));
}
