/**
 * The visible text of an HTML page, by forward scans with `indexOf`, never a backtracking regex:
 * the page is someone else's and `<[^>]+>` is quadratic on a page of unclosed `<`.
 */

import { own } from "../util/own.js";

/**
 * Named entities: the Latin-1 range and the punctuation, currency and arrows postings use. Names
 * are case-sensitive; accented letters ("uuml", "Eacute") are composed, not listed.
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

/** Elements whose content is never visible text; not `head`, whose end tag is optional. */
const HIDDEN = new Set("script style noscript template svg title".split(" "));
/** Elements whose content is text up to their first end tag: a "<main" in a script is no tag. */
const RAW = new Set("script style title textarea noscript xmp".split(" "));

/**
 * A page's furniture: navigation, sidebars, forms, dialogs. Also `header` and `footer`, unless
 * narrowed to `main` or `article`.
 */
const CHROME = new Set("nav aside form select button dialog".split(" "));

/**
 * Attributes, as `name=value` lowercased without whitespace, that hide an element: `hidden`, an
 * inline `display: none` or `opacity: 0`. Anchored, and each `.*` is followed by literals only,
 * so it stays linear.
 */
const HIDING = String.raw`hidden=|style=.*(?:display:none|opacity:0(?:\.0*)?(?:;|!|$))`;
/**
 * On a job page, also an ARIA role of furniture, `aria-hidden`, `visibility: hidden`, and an `id`
 * or `class` naming a cookie banner or other jobs.
 */
const PAGE_HIDING = new RegExp(
  `^(?:${HIDING}|style=.*visibility:hidden|aria-hidden=true$|role=(?:navigation|banner|contentinfo|complementary|dialog|alertdialog|search)$|(?:id|class)=.*(?:cookie|consent|gdpr|similar|related))`,
);
/**
 * In a document, also text under 2px or 2pt, or `visibility: hidden`; an inner element may undo
 * these, so they hide only a leaf.
 */
const DOCUMENT_HIDING = new RegExp(`^(?:${HIDING})`);
const LEAF_HIDING =
  /^style=.*(?:visibility:hidden|font-size:(?:0(?:\.0*)?(?:[a-z]+|%)?|[01](?:\.\d{1,6})?p[xt])(?:;|!|$))/;

/**
 * Phrasing elements style a run of text without breaking it: where text touches them they become
 * nothing ("Node<span>.js</span>" is "Node.js"); between sibling elements they are a space.
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
 * `indexOf` ignoring ASCII case, on the original string: `toLowerCase` can change its length
 * ("İ"), so a position in a lowercased copy would point elsewhere. `needle` must be ASCII.
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

/**
 * HTML opens a tag only when `<` is followed by a letter, `/`, `!` or `?`; otherwise it is text.
 */
function opensTag(html: string, at: number): boolean {
  const next = asciiLower(html.charCodeAt(at + 1));
  return (next >= 97 && next <= 122) || next === 47 || next === 33 || next === 63;
}

const isSpace = (char: string | undefined) =>
  char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";

/**
 * The `>` that ends the tag opened at `open`, or -1. A quoted attribute value may hold a `>`
 * (`<img alt="a > b">`) and is skipped whole; a quote opens a value only right after `=`.
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
 * an end tag]. Skips comments and the content of raw-text elements (`RAW`); stops at a tag that
 * never closes.
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
 * Where the `name` element whose start tag ends at `from` ends: past its end tag, or where the
 * next tag that implies it starts, for elements whose end tag may be omitted. Same-name elements
 * inside are counted; a raw-text element ends at its first end tag; one that never closes runs
 * to the end.
 *
 * A paragraph ends at a block that opens or an element that closes around it; a list item at
 * the next item or the list's end: `<p hidden>Two<p>Three` hides "Two" alone.
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
 * when a page has exactly one (a list of related jobs as cards is no posting).
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

/**
 * A start tag's attributes, each as `name=value` lowercased without whitespace. With `sheet`, the
 * declarations a page's style sheet gives its classes and id come first, each as a `style`
 * attribute: the tag's own `style` overrides them.
 */
function attributesOf(tag: string, sheet?: StyleSheet): string[] {
  const styled: string[] = [];
  const found: string[] = [];
  let shown = false;
  for (const [, name, ...values] of tag.slice(1 + tagName(tag).length).matchAll(ATTRIBUTE)) {
    const value = values.find((part) => part !== undefined) ?? "";
    found.push(`${name}=${value}`.toLowerCase().replace(/\s/g, ""));
    const key = name!.toLowerCase();
    if (sheet?.rules.size && (key === "class" || key === "id"))
      for (const token of value.toLowerCase().split(/\s+/)) {
        const selector = `${key === "id" ? "#" : "."}${token}`;
        shown ||= sheet.shown.has(selector);
        const declarations = token && sheet.rules.get(selector);
        if (declarations) styled.push(`style=${declarations}`);
      }
  }
  // A class the sheet shows on some screen or in some state ("hidden lg:flex", a menu opened on
  // hover) leaves the element to its own attributes.
  return shown ? found : [...styled, ...found];
}

/**
 * Whether the text colour the attributes set last is white or near white: each channel at least
 * 240 (`#f0f0f0`), the colour 1.25:1 contrast against white allows.
 */
function white(attributes: readonly string[]): boolean {
  let colour = "";
  for (const attribute of attributes)
    if (attribute.startsWith("style="))
      for (const declaration of attribute.slice(6).split(";"))
        if (declaration.startsWith("color:"))
          colour = declaration.slice(6).replace(/!important$/, "");
  if (colour === "white") return true;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(colour)?.[1];
  const channels = hex
    ? (hex.length === 3 ? [...hex].map((digit) => digit + digit) : hex.match(/../g)!).map((pair) =>
        parseInt(pair, 16),
      )
    : /^rgba?\((\d{1,3}),(\d{1,3}),(\d{1,3})(?:,[\d.%]{1,8})?\)$/
        .exec(colour)
        ?.slice(1, 4)
        .map(Number);
  return !!channels && channels.every((channel) => channel >= 240);
}

/** Whether any start tag paints a background (`background`, `bgcolor`), which leaves white text unjudged. */
function tagsPaint(html: string): boolean {
  for (const [at, end] of tagsFrom(html, 0))
    if (
      indexOfIgnoreCase(html, "background", at, end) !== -1 ||
      indexOfIgnoreCase(html, "bgcolor", at, end) !== -1
    )
      return true;
  return false;
}

/** Whether one of a start tag's attributes, as `name=value`, matches `pattern`. */
const hiddenByAttributes = (attributes: readonly string[], pattern: RegExp) =>
  attributes.some((attribute) => pattern.test(attribute));

/**
 * One selector a style sheet's hiding is read for: a class or an id, after an optional element
 * name. A name may hold escapes, as utility classes do (".lg\:flex" for class "lg:flex").
 */
const SIMPLE_SELECTOR = /^(?:[a-z][a-z0-9]*)?([.#](?:[\w-]|\\.)+)$/i;
/** Every class and id a selector names. */
const SELECTOR_NAMES = /[.#](?:[\w-]|\\.)+/g;
/** A selector's name as the document writes it: ".lg\:flex" is class "lg:flex". */
const unescaped = (name: string) => name.replace(/\\(.)/g, "$1").toLowerCase();

/** What a page's style sheet declares per class and id, and the ones it may show. */
type StyleSheet = { rules: Map<string, string>; shown: Set<string> };

/**
 * What a page's `<style>` blocks declare for each class (".name") and id ("#name"), normalised as
 * `attributesOf` normalises a `style` attribute, and whether any of it paints a background. Only
 * simple selectors are read. A class or id an at-rule names (`@media (max-width: 600px)`) is left
 * out: a rule that hides it on one screen may show it on another; so is a block for print only.
 * One forward pass over each block.
 */
function readStyleSheet(html: string): { sheet: StyleSheet; painted: boolean } {
  const sheet = new Map<string, string>();
  const responsive = new Set<string>();
  let painted = false;
  for (let at = findTag(html, "<style", 0); at !== -1;) {
    const open = tagEnd(html, at);
    if (open === -1) break;
    const close = findTag(html, "</style", open);
    const media = /\smedia\s*=\s*["']?([^"'>]*)/i.exec(html.slice(at, open))?.[1] ?? "";
    const block = html.slice(open + 1, close === -1 ? html.length : close);
    if (!media || /screen|all/i.test(media)) {
      // Comments dropped; one that never closes ends the sheet.
      const kept: string[] = [];
      let from = 0;
      for (let comment = block.indexOf("/*"); comment !== -1; comment = block.indexOf("/*", from)) {
        kept.push(block.slice(from, comment));
        const end = block.indexOf("*/", comment + 2);
        from = end === -1 ? block.length : end + 2;
      }
      const css = kept.join("") + block.slice(from);
      painted ||= /background/i.test(css);
      // The selector of the outermost block open, and of the innermost.
      let [depth, start, outer, selector] = [0, 0, "", ""];
      for (let i = 0; i < css.length; i += 1) {
        const char = css[i];
        if (char === "{") {
          selector = css.slice(start, i).trim();
          if (depth === 0) outer = selector;
          [depth, start] = [depth + 1, i + 1];
        } else if (char === "}") {
          const rule = depth === 1 ? outer : selector;
          if (depth && !rule.startsWith("@"))
            for (const part of rule.split(",")) {
              const simple = SIMPLE_SELECTOR.exec(part.trim())?.[1];
              const key = simple && unescaped(simple);
              if (key && depth > 1) responsive.add(key);
              else if (key) sheet.set(key, `${sheet.get(key) ?? ""};${css.slice(start, i)}`);
              // Named in a compound selector (".nav:hover .menu", ".open > .menu"), it may show
              // in some state: a menu opened by hovering is no hidden text (2026-10-24, a real
              // careers page read as a resume flagged its whole navigation).
              else
                for (const name of part.match(SELECTOR_NAMES) ?? [])
                  responsive.add(unescaped(name));
            }
          [depth, start] = [Math.max(0, depth - 1), i + 1];
        } else if (char === ";" && depth === 0) start = i + 1;
      }
    }
    if (close === -1) break;
    at = findTag(html, "<style", close);
  }
  for (const key of responsive) sheet.delete(key);
  for (const [key, declarations] of sheet)
    sheet.set(key, declarations.toLowerCase().replace(/\s/g, ""));
  return { sheet: { rules: sheet, shown: responsive }, painted };
}

/** A start tag naming the element a page's navigation or footer (`role="navigation"`, `"contentinfo"`). */
const NAVIGATION_ROLE = /\srole\s*=\s*["']?(?:navigation|contentinfo)(?![\w-])/i;

/** Elements that have no end tag: hiding one hides nothing after it. */
const VOID = new Set("br hr img input meta link".split(" "));

/**
 * An HTML document read for its text: `hidden`, the text of the elements dropped as hidden
 * (`document` mode), and `tables`, the tables read.
 */
export type HtmlReading = { text: string; hidden: string[]; tables: number };

/**
 * The visible text of an HTML document or fragment, one line per block, entities decoded.
 * Block elements become line breaks; phrasing elements join the text around them. Script, style,
 * the title and similar elements are dropped with their content, and an element left unclosed
 * drops everything after it. A `<` that cannot open a tag ("<5k") is text.
 *
 * `page`: a whole web page read for its posting: narrowed to `<main>` or the one `<article>`,
 * with navigation, forms, dialogs, cookie banners, "similar jobs" and hidden elements dropped.
 *
 * `document`: a resume. Elements a reader cannot see (`hidden`, `display: none`, `opacity: 0`,
 * text under 2px) are dropped and their text kept in `hidden`; nothing is furniture.
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
  // A resume's style sheet hides by class too; white text hides on a page that paints no
  // background anywhere, which leaves it white.
  const { sheet, painted } =
    mode === "document" ? readStyleSheet(html) : { sheet: undefined, painted: true };
  const plain = !painted && !tagsPaint(html);
  const out: string[] = [];
  const hidden: string[] = [];
  let tables = 0;
  let index = 0;

  let text = 0; // where the text since the last tag began
  let navEnd = -1; // where the navigation the reading is in ends
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
    if (close === -1) break;
    const tag = html.slice(open, close + 1);
    const name = tagName(tag);
    const starts = html[open + 1] !== "/";
    index = close + 1;

    if (starts && (HIDDEN.has(name) || chrome.has(name))) {
      if (!tag.endsWith("/>")) index = skipElement(html, name, index);
      continue;
    }
    // Where a page's navigation or footer ends: their closed menus are a site's, not a resume's
    // hidden text (2026-10-24: a saved page's mega-menu read as 5,082 hidden characters). Found
    // from the outermost one only, so nested or unclosed navigation is scanned once.
    if (
      mode === "document" &&
      starts &&
      index > navEnd &&
      !tag.endsWith("/>") &&
      (name === "nav" || name === "footer" || NAVIGATION_ROLE.test(tag))
    )
      navEnd = skipElement(html, name, index);
    // Hidden by its attributes; size, visibility or white text hides only a leaf (its end tag the
    // next tag).
    const next = html.indexOf("<", index);
    const attributes =
      starts && hides && /\s/.test(tag) && !VOID.has(name) && attributesOf(tag, sheet);
    if (
      attributes &&
      (hiddenByAttributes(attributes, hides) ||
        (mode === "document" &&
          indexOfIgnoreCase(html, `</${name}`, next, next + 1) === next &&
          (hiddenByAttributes(attributes, LEAF_HIDING) || (plain && white(attributes)))))
    ) {
      // A `/>` closes only a void element: `<span hidden/>` opens a span, as a browser reads it.
      const end = skipElement(html, name, index);
      if (mode === "document" && index >= navEnd)
        hidden.push(readHtml(html.slice(index, end)).text);
      index = end;
      continue;
    }
    if (starts && name === "table") tables += 1;
    // A list item keeps its marker, so it is never taken for a heading.
    if (name === "li" && starts) out.push("\n• ");
    else out.push(BLOCK.has(name) ? "\n" : INLINE.has(name) && open > text ? "" : " ");
    text = index;
  }

  return { text: decodeEntities(out.join("")), hidden, tables };
}

/** `readHtml`'s text: a job page's (`page`), or every element's. */
export const htmlText = (html: string, page = false) =>
  readHtml(html, page ? "page" : undefined).text;
