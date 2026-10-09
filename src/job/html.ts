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

/** Elements whose content is never visible text. A document's head is not one of them: its end
 * tag is optional, and what it holds (title, style, script) is dropped on its own. */
const HIDDEN = new Set("script style noscript template svg title".split(" "));
/** Elements whose content is text up to their first end tag: a "<main" in a script is no tag. */
const RAW = new Set("script style title textarea noscript xmp".split(" "));

/**
 * A page's furniture rather than its posting: navigation, sidebars, forms and their controls,
 * dialogs. `header` and `footer` too, unless the text was narrowed to `main` or `article`,
 * where they hold the posting's own title.
 */
const CHROME = new Set("nav aside form select button dialog".split(" "));

/**
 * Attributes, as `name=value` lowercased without whitespace, that hide an element: `hidden`, an
 * inline `display: none` or `opacity: 0`. Anchored, and each `.*` is followed by literals only,
 * so it stays linear.
 */
const HIDING = String.raw`hidden=|style=.*(?:display:none|opacity:0(?:\.0*)?(?:;|!|$))`;
/** On a job page, also an ARIA role of furniture, `aria-hidden`, `visibility: hidden`, and an
 * `id` or `class` naming a cookie banner or a list of other jobs. */
const PAGE_HIDING = new RegExp(
  `^(?:${HIDING}|style=.*visibility:hidden|aria-hidden=true$|role=(?:navigation|banner|contentinfo|complementary|dialog|alertdialog|search)$|(?:id|class)=.*(?:cookie|consent|gdpr|similar|related))`,
);
/** In a document, also text under 2px or 2pt, or `visibility: hidden` — which an element inside
 * may undo, so these hide only an element with no elements of its own. */
const DOCUMENT_HIDING = new RegExp(`^(?:${HIDING})`);
const LEAF_HIDING =
  /^style=.*(?:visibility:hidden|font-size:(?:0(?:\.0*)?(?:[a-z]+|%)?|[01](?:\.\d{1,6})?p[xt])(?:;|!|$))/;

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
 * Each tag from `from` on, as [where it opens, past its `>`, its lowercased name, whether it is
 * an end tag]. Comments are skipped, and so is the content of a raw-text element (`RAW`), which
 * holds no tags. Stops at a tag that never closes. One forward pass.
 */
function* tagsFrom(html: string, from: number): Generator<[number, number, string, boolean]> {
  for (let at = html.indexOf("<", from); at !== -1;) {
    let next = at + 1;
    if (html.startsWith("<!--", at)) {
      next = html.indexOf("-->", at + 4) + 3;
      if (next < 3) return;
    } else if (opensTag(html, at)) {
      const end = tagEnd(html, at) + 1;
      if (!end) return;
      const name = tagName(html.slice(at, end));
      const closing = html[at + 1] === "/";
      yield [at, end, name, closing];
      next = !closing && RAW.has(name) ? skipElement(html, name, end) : end;
    }
    at = html.indexOf("<", next);
  }
}

/**
 * Where the `name` element whose start tag ends at `from` ends: past its end tag, or — for one
 * whose end tag HTML lets an author omit — where the next tag that ends it starts. Elements of
 * the same name inside it are counted, so an `<svg>` nested in another does not end the outer
 * one early; a raw-text element ends at its first end tag. One that never closes runs to the
 * end. Linear in what it skips.
 *
 * A paragraph ends at a block that opens or an element that closes around it; a list item at
 * the next item of its list or the list's end: `<p hidden>Two<p>Three` hides "Two" alone.
 */
function skipElement(html: string, name: string, from: number): number {
  if (RAW.has(name)) {
    const close = findTag(html, `</${name}`, from);
    return close === -1 ? html.length : html.indexOf(">", close) + 1 || html.length;
  }
  const item = name === "li";
  let depth = 0;
  for (const [at, end, tag, closing] of tagsFrom(html, from)) {
    if (
      name === "p"
        ? closing
          ? !INLINE.has(tag)
          : BLOCK.has(tag) && tag !== "br"
        : item && !depth && tag === "li"
    )
      return closing && tag === name ? end : at;
    if (item ? tag !== "ul" && tag !== "ol" : tag !== name) continue;
    if (closing && !depth--) return item ? at : end;
    if (!closing && html[end - 2] !== "/") depth += 1;
  }
  return html.length;
}

/**
 * The first `<main>`, else the one `<article>` outside navigation, sidebars and other articles,
 * where a page has exactly one: a list of related jobs as cards is no posting. Tags in scripts
 * and comments are not counted.
 */
function landmark(html: string): number {
  let [article, articles, nested, furniture] = [-1, 0, 0, 0];
  for (const [at, , name, closing] of tagsFrom(html, 0)) {
    const step = closing ? -1 : 1;
    if (name === "main" && !closing) return at;
    if (name === "aside" || name === "nav") furniture = Math.max(0, furniture + step);
    if (name !== "article") continue;
    if (!closing && !furniture && !nested) [article, articles] = [at, articles + 1];
    nested = Math.max(0, nested + step);
  }
  return articles === 1 ? article : -1;
}

/** Each attribute of a tag, name and value; one forward pass, each match consuming input. */
const ATTRIBUTE = /([^\s"'=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/** Whether one of a start tag's attributes, as `name=value`, matches `pattern`. */
function hiddenByAttributes(tag: string, pattern: RegExp): boolean {
  return [...tag.slice(1 + tagName(tag).length).matchAll(ATTRIBUTE)].some(([, name, ...values]) =>
    pattern.test(
      `${name}=${values.find((part) => part !== undefined) ?? ""}`.toLowerCase().replace(/\s/g, ""),
    ),
  );
}

/** Elements that have no end tag: hiding one hides nothing after it. */
const VOID = new Set("br hr img input meta link".split(" "));

/**
 * An HTML document read for its text: `hidden`, the text of the elements dropped as hidden
 * (`document` mode), and `tables`, the tables read.
 */
export type HtmlReading = { text: string; hidden: string[]; tables: number };

/**
 * The visible text of an HTML document or fragment, one line per block, entities decoded and
 * whitespace as the page had it.
 *
 * Block elements become line breaks, so headings and bullets survive as lines instead of
 * collapsing into one paragraph; phrasing elements (`b`, `span`, `sup`, …) join the text
 * around them. Script, style, the document's title and similar elements are dropped with their
 * content; an element left unclosed drops everything after it, which on a well-formed page never
 * happens and on a hostile one is the safe direction. A `<` that cannot open a tag ("<5k") is
 * text, as it is to a browser.
 *
 * `page`: the input is a whole web page, read for the posting on it. The text is narrowed to its
 * `<main>` (or its one `<article>`) when it has one, and navigation, sidebars, forms, dialogs,
 * cookie banners, "similar jobs" lists and elements hidden by `hidden`, `aria-hidden` or an
 * inline `display: none` are dropped.
 *
 * `document`: the input is a resume. Elements a reader cannot see — `hidden`, `display: none`,
 * `opacity: 0`, text under 2px — are dropped and their text kept in `hidden`; nothing is
 * furniture.
 */
export function readHtml(html: string, mode?: "page" | "document"): HtmlReading {
  let chrome = new Set(mode === "page" ? [...CHROME, "header", "footer"] : []);
  if (mode === "page") {
    const start = landmark(html);
    if (start !== -1) {
      const open = tagEnd(html, start) + 1;
      html = html.slice(start, skipElement(html, tagName(html.slice(start, open)), open));
      chrome = CHROME;
    }
  }
  const hides = mode === "page" ? PAGE_HIDING : mode && DOCUMENT_HIDING;
  const out: string[] = [];
  const hidden: string[] = [];
  let tables = 0;
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

    if (starts && (HIDDEN.has(name) || chrome.has(name))) {
      if (!tag.endsWith("/>")) index = skipElement(html, name, index);
      continue;
    }
    // An element hidden by its attributes; one whose size or visibility hides it only when it
    // holds text alone, its end tag the next tag: an element inside may set its own.
    const next = html.indexOf("<", index);
    if (
      starts &&
      hides &&
      /\s/.test(tag) &&
      !VOID.has(name) &&
      (hiddenByAttributes(tag, hides) ||
        (mode === "document" &&
          indexOfIgnoreCase(html, `</${name}`, next, next + 1) === next &&
          hiddenByAttributes(tag, LEAF_HIDING)))
    ) {
      const end = tag.endsWith("/>") ? index : skipElement(html, name, index);
      if (mode === "document") hidden.push(readHtml(html.slice(index, end)).text);
      index = end;
      continue;
    }
    if (starts && name === "table") tables += 1;
    // A list item keeps its marker, so it reads as the bullet it is — to a resume's content
    // rules, and to a posting's heading detection, which must not take an item for a heading.
    // A phrasing tag that text touches joins it; between two sibling elements — skill tags,
    // "<span>Spark</span><span>Kafka</span>" — it is still a space.
    if (name === "li" && starts) out.push("\n• ");
    else out.push(BLOCK.has(name) ? "\n" : INLINE.has(name) && open > text ? "" : " ");
    text = index;
  }

  return { text: decodeEntities(out.join("")), hidden, tables };
}

/** `readHtml`'s text: a job page's (`page`), or every element's. */
export const htmlText = (html: string, page = false) =>
  readHtml(html, page ? "page" : undefined).text;
