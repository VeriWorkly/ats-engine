import { crc32, inflateRawSync } from "node:zlib";

/**
 * Hidden text in a Word document: the DOCX side of "white fonting".
 *
 * Text extraction reads every run in `word/document.xml` whatever its formatting, so a run an
 * author hid is read by an ATS like any other. A run counts as hidden when Word itself would not
 * show it to a reader:
 * - marked hidden (`w:vanish`);
 * - smaller than 2pt (`w:sz` is in half-points);
 * - in white or near white, on a white background. The background is whatever shading lies
 *   under the run — its own, its paragraph's, its table cell's — else the page colour, so white
 *   text in a dark cell is not flagged. Text in a text box is not judged: its background is the
 *   shape's fill, which this does not read.
 *
 * Character styles that hide text are not followed; direct formatting is what the tricks use.
 */

const MAX_XML_BYTES = 8 * 1024 * 1024;

/**
 * What a whole DOCX may expand to. A resume with photos is a few megabytes; past this it is a
 * zip bomb, refused before `mammoth` — which inflates whatever it reads without a limit — sees it.
 */
export const MAX_DOCX_EXPANDED_BYTES = 64 * 1024 * 1024;

/**
 * One entry as JSZip 3.10 — `mammoth`'s reader — reads it. `body` is the compressed data;
 * `size` the uncompressed size the directory declares (JSZip keeps no data for an entry
 * declaring 0); `key` the name JSZip files it under.
 */
export type ZipEntry = {
  name: string;
  key: string;
  method: number;
  body: Buffer;
  size: number;
  dir: boolean;
  /** A file whose Unix mode says folder: JSZip files it as a folder, then fails to find it. */
  unixDir: boolean;
};

const LOCAL_FILE = 0x04034b50;
const CENTRAL_FILE = 0x02014b50;
const END = 0x06054b50;
const ZIP64_LOCATOR = 0x07064b50;
const ZIP64_END = 0x06064b50;

/**
 * JSZip's `DataReader`: every index is relative to `zero` (where the archive starts, past any
 * bytes prepended to it) and every read is bounds-checked, throwing where JSZip throws.
 */
class Reader {
  index = 0;
  zero = 0;
  constructor(private readonly data: Buffer) {}

  private check(index: number) {
    if (this.data.length < this.zero + index || index < 0) throw new RangeError("End of data");
  }
  setIndex(index: number) {
    this.check(index);
    this.index = index;
  }
  skip(count: number) {
    this.setIndex(this.index + count);
  }
  /**
   * Little-endian, folded through 32-bit shifts as JSZip folds it: four bytes read as a signed
   * 32-bit integer (0xFFFFFFFF is -1), and eight as their low four.
   */
  int(size: number) {
    this.check(this.index + size);
    let value = 0;
    for (let at = this.index + size - 1; at >= this.index; at -= 1)
      value = (value << 8) + this.data[this.zero + at]!;
    this.index += size;
    return value;
  }
  /** As JSZip slices: a negative size yields nothing and steps back. */
  bytes(size: number) {
    this.check(this.index + size);
    const start = this.zero + this.index;
    this.index += size;
    return this.data.subarray(start, start + size);
  }
  signature(expected: number) {
    return this.bytes(4).readUInt32LE(0) === expected;
  }
  expect(expected: number) {
    if (!this.signature(expected)) throw new Error("Unexpected signature");
  }
  isSignature(index: number, expected: number) {
    const current = this.index;
    this.setIndex(index);
    const found = this.signature(expected);
    this.index = current;
    return found;
  }
  /** Over the whole file, not just its tail: JSZip does not stop at a comment's 64K. */
  lastIndexOf(signature: number) {
    const needle = Buffer.alloc(4);
    needle.writeUInt32LE(signature);
    const found = this.data.lastIndexOf(needle);
    return found < 0 ? -1 : found - this.zero;
  }
}

/** JSZip's `readEndOfCentral`: the directory's offset and its records, `reader.zero` set. */
function readEndOfCentral(reader: Reader) {
  const end = reader.lastIndexOf(END);
  if (end < 0) throw new Error("No end of central directory");
  reader.setIndex(end);
  reader.expect(END);
  const disk = reader.int(2);
  const directoryDisk = reader.int(2);
  const recordsOnDisk = reader.int(2);
  let records = reader.int(2);
  let size = reader.int(4);
  let offset = reader.int(4);
  reader.bytes(reader.int(2));

  // Any one of the six at its maximum makes it ZIP64 — not only the three a writer sets.
  const zip64 =
    disk === 0xffff ||
    directoryDisk === 0xffff ||
    recordsOnDisk === 0xffff ||
    records === 0xffff ||
    size === -1 ||
    offset === -1;
  let expectedEnd = offset + size;
  if (zip64) {
    const locator = reader.lastIndexOf(ZIP64_LOCATOR);
    if (locator < 0) throw new Error("No ZIP64 locator");
    reader.setIndex(locator);
    reader.expect(ZIP64_LOCATOR);
    reader.int(4);
    let record = reader.int(8);
    if (reader.int(4) > 1) throw new Error("Multi-volume");
    // A record away from where its locator says is looked for: the last one in the file.
    if (!reader.isSignature(record, ZIP64_END)) {
      record = reader.lastIndexOf(ZIP64_END);
      if (record < 0) throw new Error("No ZIP64 end of central directory");
    }
    reader.setIndex(record);
    reader.expect(ZIP64_END);
    const recordSize = reader.int(8);
    reader.skip(4);
    reader.int(4);
    reader.int(4);
    reader.int(8);
    records = reader.int(8);
    size = reader.int(8);
    offset = reader.int(8);
    // JSZip's loop over a record's extensible data never advances its counter: it reads until
    // it throws, or — where a field's length steps back over itself — forever.
    if (recordSize - 44 > 0) throw new Error("ZIP64 extensible data");
    // The record's declared size, not its fixed one, is what JSZip expects between the
    // directory and the end record.
    expectedEnd = offset + size + 20 + 12 + recordSize;
  }

  // Bytes before the archive shift every offset in it: the gap is where it starts.
  const extra = end - expectedEnd;
  if (extra > 0) {
    if (!reader.isSignature(end, CENTRAL_FILE)) reader.zero = extra;
  } else if (extra < 0) throw new Error("Missing bytes");
  return { records, offset };
}

/** The value of an extra field JSZip reads with its own reader: the ZIP64 sizes, a Unicode path. */
type Extras = Map<number, Buffer>;

/** JSZip's `findExtraFieldUnicodePath` / `…Comment`: null where it is stale or absent. */
function unicodeExtra(extras: Extras, id: number, original: Buffer): string | null {
  const field = extras.get(id);
  if (!field) return null;
  const reader = new Reader(field);
  if (reader.int(1) !== 1) return null;
  if ((original.length ? crc32(original) | 0 : 0) !== reader.int(4)) return null;
  return reader.bytes(field.length - 5).toString("utf8");
}

/** JSZip's `readCentralPart` then `readLocalPart` and `handleUTF8`, for one entry. */
function readCentral(reader: Reader) {
  const madeBy = reader.int(2);
  reader.skip(2);
  const flags = reader.int(2);
  const method = reader.int(2);
  reader.int(4);
  reader.int(4);
  let compressedSize = reader.int(4);
  let size = reader.int(4);
  const nameLength = reader.int(2);
  const extraLength = reader.int(2);
  const commentLength = reader.int(2);
  reader.int(2);
  reader.int(2);
  const external = reader.int(4);
  let local = reader.int(4);
  if (flags & 1) throw new Error("Encrypted");
  reader.skip(nameLength);

  const extras: Extras = new Map();
  const extrasEnd = reader.index + extraLength;
  while (reader.index + 4 < extrasEnd) {
    const id = reader.int(2);
    extras.set(id, reader.bytes(reader.int(2)));
  }
  reader.setIndex(extrasEnd);
  const zip64 = extras.get(1);
  if (zip64) {
    const field = new Reader(zip64);
    if (size === -1) size = field.int(8);
    if (compressedSize === -1) compressedSize = field.int(8);
    if (local === -1) local = field.int(8);
  }
  const comment = reader.bytes(commentLength);
  return { madeBy, flags, method, compressedSize, size, external, local, extras, comment };
}

function readLocal(reader: Reader, entry: ReturnType<typeof readCentral>): ZipEntry {
  reader.setIndex(entry.local);
  reader.expect(LOCAL_FILE);
  reader.skip(22);
  const nameLength = reader.int(2);
  const extraLength = reader.int(2);
  // The name JSZip files an entry under is its local header's, not its directory header's.
  const nameBytes = reader.bytes(nameLength);
  reader.skip(extraLength);
  if (entry.compressedSize === -1 || entry.size === -1) throw new Error("Sizes unknown");
  if (entry.method !== 0 && entry.method !== 8) throw new Error("Unknown compression");
  const body = reader.bytes(entry.compressedSize);

  let name = nameBytes.toString("utf8");
  if (!(entry.flags & 0x800)) {
    name = unicodeExtra(entry.extras, 0x7075, nameBytes) ?? name;
    unicodeExtra(entry.extras, 0x6375, entry.comment);
  }
  const platform = entry.madeBy >> 8;
  const dir = !!(entry.external & 0x10) || name.slice(-1) === "/";
  const unixDir = platform === 3 && !!((entry.external >> 16) & 0xffff & 0x4000);
  const key = resolvePath(name);
  return {
    name,
    key: dir || unixDir ? (key.slice(-1) === "/" ? key : `${key}/`) : key,
    method: entry.method,
    body,
    size: entry.size,
    dir: dir || unixDir,
    unixDir: unixDir && !dir,
  };
}

/** JSZip's `utils.resolve`: "." and empty segments dropped, ".." steps back. */
function resolvePath(path: string) {
  const parts = path.split("/");
  const result: string[] = [];
  parts.forEach((part, index) => {
    if (part === "." || (part === "" && index !== 0 && index !== parts.length - 1)) return;
    if (part === "..") result.pop();
    else result.push(part);
  });
  return result.join("/");
}

/**
 * The entries of a zip archive in directory order, read exactly as JSZip's `ZipEntries.load`
 * reads them; null wherever JSZip throws, or would loop.
 *
 * The expansion budget holds only over the entries JSZip will inflate, so this does not read
 * the archive its own way: every signature search, the ZIP64 switch, the shift for prepended
 * bytes and the directory walk are JSZip's, quirks included. Linear in the file: each directory
 * header advances the walk by at least 46 bytes.
 */
export function zipEntries(data: Uint8Array): ZipEntry[] | null {
  try {
    const reader = new Reader(Buffer.from(data.buffer, data.byteOffset, data.byteLength));
    const { records, offset } = readEndOfCentral(reader);
    reader.setIndex(offset);
    const headers: Array<ReturnType<typeof readCentral>> = [];
    while (reader.signature(CENTRAL_FILE)) headers.push(readCentral(reader));
    // Records claimed and none found JSZip refuses; fewer than claimed it reads.
    if (records !== headers.length && records !== 0 && headers.length === 0)
      throw new Error("No records");
    return headers.map((header) => readLocal(reader, header));
  } catch {
    return null;
  }
}

/**
 * What JSZip then holds, by the name `mammoth` asks for: a later entry of a name replaces an
 * earlier one. Null where `loadAsync` fails.
 */
export function zipFiles(data: Uint8Array): Map<string, ZipEntry> | null {
  const entries = zipEntries(data);
  if (!entries) return null;
  const files = new Map<string, ZipEntry>();
  for (const entry of entries) {
    files.set(entry.key, entry);
    // JSZip looks the file up again under the name it meant to file it at, and throws if a
    // folder took it.
    if (entry.unixDir && files.get(resolvePath(entry.name))?.dir !== false) return null;
  }
  return files;
}

/**
 * Whether this reader can follow the archive and the relationships naming its parts:
 * `withinExpansionLimit` refuses the rest.
 */
export const readableArchive = (data: Uint8Array) => {
  const files = zipFiles(data);
  return !!files && !!mammothParts(files);
};

/** An entry's content, or null past `limit` bytes. Capped: a bomb costs the cap, not its claim. */
function inflate({ method, body, size }: ZipEntry, limit: number): Buffer | null {
  if (size === 0) return Buffer.alloc(0);
  if (method === 0) return body.length <= limit ? body : null;
  try {
    return inflateRawSync(body, { maxOutputLength: limit });
  } catch {
    return null;
  }
}

/** One file from a zip archive, as JSZip gives it to `mammoth`, or null. No dependency. */
export function readZipEntry(data: Uint8Array, name: string): Buffer | null {
  const entry = zipFiles(data)?.get(name);
  return entry && !entry.dir ? inflate(entry, MAX_XML_BYTES) : null;
}

const PACKAGE_RELATIONSHIPS = "http://schemas.openxmlformats.org/package/2006/relationships";
const MARKUP_COMPATIBILITY = "http://schemas.openxmlformats.org/markup-compatibility/2006";
const RELATIONSHIP_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/";
/** A relationships file is a few kilobytes; one past this is not followed. */
const MAX_RELS_BYTES = 1024 * 1024;

const XML_ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["quot", '"'],
]);

/** `@xmldom/xmldom` 0.8's `entityReplacer`; null for a name it reports as an error. */
function entity(reference: string): string | null {
  const name = reference.slice(1, -1);
  if (XML_ENTITIES.has(name)) return XML_ENTITIES.get(name)!;
  if (name[0] !== "#") return null;
  let code = parseInt(name.slice(1).replace("x", "0x"));
  if (code <= 0xffff || Number.isNaN(code)) return String.fromCharCode(code);
  code -= 0x10000;
  return String.fromCharCode(0xd800 + (code >> 10), 0xdc00 + (code & 0x3ff));
}

/** An attribute's value as `@xmldom/xmldom` 0.8 gives it, or null where it reports an error. */
function attributeValue(raw: string): string | null {
  if (raw.replace(/&#?\w+;/g, "").includes("&")) return null;
  let unknown = false;
  const value = raw
    .replace(/[\t\n\r]/g, " ")
    .replace(/&#?\w+;/g, (reference) => entity(reference) ?? ((unknown = true), ""));
  return unknown ? null : value;
}

const QNAME = /^(?:([A-Za-z_][\w.-]*):)?([A-Za-z_][\w.-]*)$/;
const RELS_TAG = /<(\/?)([^\s<>/=]+)((?:\s+[^\s<>/=]+\s*=\s*(?:"[^"<]*"|'[^'<]*'))*)\s*(\/?)>/y;
const RELS_ATTR = /\s+([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/**
 * A relationships part as `mammoth` reads it: the targets of each type, in order, of the
 * `Relationship` elements in the package namespace directly under the root. Null for anything
 * this cannot read as `mammoth`'s parser does — a DTD, an unknown entity or prefix, unbalanced or
 * malformed tags, markup-compatibility content — which no writer puts in such a file. Linear:
 * each tag pattern stops at the next `<`.
 */
function relationshipTargets(bytes: Buffer): Map<string, string[]> | null {
  // The decoder drops one byte-order mark and `mammoth` another.
  const text = new TextDecoder().decode(bytes);
  const xml = withoutMarkup(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
  const targets = new Map<string, string[]>();
  const scopes: Array<Map<string, string>> = [new Map()];
  let roots = 0;
  for (let at = xml.indexOf("<"); at >= 0; at = xml.indexOf("<", at)) {
    RELS_TAG.lastIndex = at;
    const match = RELS_TAG.exec(xml);
    if (!match) return null;
    at = RELS_TAG.lastIndex;
    const [, closing, name, attrs, selfClosing] = match;
    const qualified = QNAME.exec(name!);
    if (!qualified) return null;
    const [, prefix = "", local] = qualified;
    if (closing) {
      if (attrs || selfClosing || scopes.length < 2 || scopes.pop()!.get("\0") !== name)
        return null;
      continue;
    }
    if (scopes.length === 1 && roots++) return null;
    // The prefixes in scope, and under "\0" the element's name, which its end tag must repeat.
    const scope = new Map(scopes[scopes.length - 1]);
    scope.set("\0", name!);
    const values = new Map<string, string>();
    for (const [, key, double, single] of attrs!.matchAll(RELS_ATTR)) {
      const value = attributeValue(double ?? single!);
      if (value === null || values.has(key!)) return null;
      values.set(key!, value);
      if (key === "xmlns") scope.set("", value);
      else if (key!.startsWith("xmlns:")) scope.set(key!.slice(6), value);
    }
    const namespace = scope.get(prefix) || undefined;
    if (prefix && namespace === undefined) return null;
    if (namespace === MARKUP_COMPATIBILITY && local === "AlternateContent") return null;
    if (scopes.length === 2 && namespace === PACKAGE_RELATIONSHIPS && local === "Relationship") {
      const type = values.get("Type") ?? "undefined";
      if (!targets.has(type)) targets.set(type, []);
      targets.get(type)!.push(values.get("Target") ?? "");
    }
    if (!selfClosing) scopes.push(scope);
  }
  return scopes.length === 1 && roots === 1 ? targets : null;
}

/** `mammoth`'s `zipfile.joinPath`: empty segments dropped, an absolute one starts afresh. */
function joinPath(...paths: string[]) {
  let joined: string[] = [];
  for (const path of paths.filter(Boolean)) joined = path[0] === "/" ? [path] : [...joined, path];
  return joined.join("/");
}

const splitPath = (path: string) => {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? ["", path] : [path.slice(0, slash), path.slice(slash + 1)];
};

const relationshipsOf = (path: string) => {
  const [dirname, basename] = splitPath(path);
  return joinPath(dirname!, "_rels", `${basename}.rels`);
};

/** A page header or footer part, which `mammoth` does not read and `docxMargins` does. */
const HEADER_OR_FOOTER = /^word\/(?:header|footer)\d*\.xml$/;

/**
 * The parts `mammoth` 1.x's `docx-reader` reads, and how many times it reads each: its content
 * types, its main document — the package's `officeDocument` relationship, else
 * `word/document.xml` — that document's relationships (twice), its styles, numbering, notes and
 * comments as those name them, and the relationships of the notes and comments. A relationship
 * may name any part, the main document itself included, and each read inflates it again. Null
 * where a relationships file cannot be read.
 */
function mammothParts(files: Map<string, ZipEntry>) {
  const exists = (path: string) => files.get(path)?.dir === false;
  const reads = new Map<string, number>();
  // The reads `mammoth` parses as XML: all but the embedded chunks, headers and footers.
  const parsed = new Map<string, number>();
  const read = (path: string, xml = true) => {
    reads.set(path, (reads.get(path) ?? 0) + 1);
    if (xml) parsed.set(path, (parsed.get(path) ?? 0) + 1);
  };
  read("[Content_Types].xml");
  const relationships = (path: string) => {
    read(path);
    if (!exists(path)) return new Map<string, string[]>();
    const content = inflate(files.get(path)!, MAX_RELS_BYTES);
    return content && relationshipTargets(content);
  };
  const find = (from: Map<string, string[]>, type: string, base: string, fallback: string) =>
    (from.get(RELATIONSHIP_TYPE + type) ?? [])
      .map((target) => joinPath(base, target).replace(/^\//, ""))
      .find(exists) ?? fallback;

  const packageRelationships = relationships("_rels/.rels");
  if (!packageRelationships) return null;
  const main = find(packageRelationships, "officeDocument", "", "word/document.xml");
  if (!exists(main)) return { main, reads, parsed, styles: null, chunks: [], comments: null };
  const related = relationships(relationshipsOf(main));
  if (!related) return null;
  const [base] = splitPath(main);
  const part = (name: string) => find(related, name, base!, `word/${name}.xml`);
  const styles = part("styles");
  read(styles);
  read(part("numbering"));
  const comments = part("comments");
  for (const path of [...["footnotes", "endnotes"].map(part), comments, main]) {
    read(relationshipsOf(path));
    read(path);
  }
  // Content a web builder embeds whole (`w:altChunk`) — HTML, usually as MHT — which `mammoth`
  // does not read: what this reads instead.
  const chunks = (related.get(`${RELATIONSHIP_TYPE}aFChunk`) ?? [])
    .map((target) => joinPath(base!, target).replace(/^\//, ""))
    .filter(exists);
  for (const chunk of chunks) read(chunk, false);
  for (const key of files.keys()) if (HEADER_OR_FOOTER.test(key)) read(key, false);
  return {
    main,
    reads,
    parsed,
    styles: exists(styles) ? styles : null,
    chunks,
    comments: exists(comments) ? comments : null,
  };
}

/**
 * Whether the whole archive expands to at most `MAX_DOCX_EXPANDED_BYTES`. Inflates every file
 * JSZip can give `mammoth` against what is left of the budget rather than trusting the sizes
 * the archive declares, which a bomb sets to whatever passes, and charges each part as many
 * times as `mammoth` reads it. An archive this reader cannot follow is refused, not left to
 * `mammoth`: what it could not measure, `mammoth` may still inflate in full.
 *
 * Entries whose data overlap — many headers naming one body, each inflated again — are refused
 * too: no writer produces them, and they would make this check cost more than the file.
 */
export function withinExpansionLimit(data: Uint8Array): boolean {
  const files = zipFiles(data);
  const parts = files && mammothParts(files);
  if (!files || !parts) return false;
  let left = MAX_DOCX_EXPANDED_BYTES;
  let input = data.byteLength;
  for (const entry of files.values()) {
    if (entry.dir || entry.size === 0) continue;
    input -= entry.body.length;
    if (input < 0) return false;
    const reads = Math.max(1, parts.reads.get(entry.key) ?? 0);
    const content = inflate(entry, Math.floor(left / reads));
    if (!content) return false;
    left -= content.length * reads;
  }
  return true;
}

/**
 * The most XML `mammoth` is given to parse: every part it parses, each charged as often as it
 * parses it. Its parser takes up to about a second a megabyte on dense markup — a tag or a line
 * every few bytes — so this keeps the worst accepted document near two seconds. Word's own
 * templates hold under 600 KB, their resumes under 120 KB, most of it the styles part.
 */
const MAX_PARSED_XML_BYTES = 2 * 1024 * 1024;

/**
 * The most the parts `mammoth` parses may hold, between them, of each of:
 * - comments, processing instructions and CDATA sections. Word writes one processing instruction
 *   a part (the `<?xml ?>` declaration) and none of the others; closed, each costs the parser
 *   little, so this only bounds what no writer produces;
 * - distinct elements (a name in a namespace), and style, break, symbol and content-type tags
 *   whose values `mammoth` puts in a warning. It merges its warnings pairwise, so N distinct ones
 *   cost N²: 10,000 took twelve seconds. Word's templates hold under 300.
 */
const MAX_MARKUP = 1_000;

/**
 * The tags whose values reach a `mammoth` warning, by local name, with or without a prefix: a
 * style it does not know (`pStyle`, `rStyle`, `tblStyle`), a break or symbol it does not know,
 * an image's content type (`Default`, `Override`).
 */
const NAMED_TAG = /(?:^|:)(?:[A-Za-z]*Style|br|sym|Default|Override)$/;

/**
 * What a DOCX upload that is not one, or not one to give `mammoth`, fails with; where `mammoth`
 * fails, its own error is kept as the cause.
 */
export const UNREADABLE_DOCX = "The document could not be read as DOCX.";

/**
 * Refuses a document before `mammoth` parses any of it: with `UNREADABLE_DOCX` where its XML
 * parser (`@xmldom/xmldom` 0.8) would not read every part in time linear in it, or its warnings
 * would cost their square; as too long past `MAX_PARSED_XML_BYTES`. Every part it parses is
 * read: content types, relationships, styles, numbering, notes, comments and the document. Run
 * after `withinExpansionLimit`, within which every part inflated.
 *
 * The parser goes back to the end of the part for each comment, processing instruction or CDATA
 * section that never closes, so a 1.4 KB file of `<!--` held it for two minutes. A `<` that
 * starts no tag, or a tag cut short, is an error that costs it tens of microseconds each, and a
 * document type declaration no OOXML part may hold. Each is an error `mammoth` then refuses the
 * document for, or markup no writer produces. So is a prefix bound, within a part, to a second
 * namespace: refused, each prefix names one namespace, and an element is counted once by its
 * name in it. Each tag is matched by `RELS_TAG`, which stops at the next `<`: linear, each step
 * starting where the last ended.
 */
export function checkParsedXml(data: Uint8Array): void {
  const files = zipFiles(data);
  const seen = new Set<string>();
  let markup = 0;
  let left = MAX_PARSED_XML_BYTES;
  const readable = (xml: string) => {
    // Each prefix's namespace in this part ("" the default one).
    const namespaces = new Map<string, string>();
    for (let at = xml.indexOf("<"); at >= 0; at = xml.indexOf("<", at)) {
      const open = xml.startsWith("<!--", at)
        ? "<!--"
        : xml.startsWith("<![CDATA[", at)
          ? "<![CDATA["
          : xml.startsWith("<?", at)
            ? "<?"
            : "";
      if (open) {
        at = xml.indexOf(MARKUP_CLOSE.get(open)!, at + open.length);
        if (at < 0 || ++markup > MAX_MARKUP) return false;
        continue;
      }
      RELS_TAG.lastIndex = at;
      const tag = RELS_TAG.exec(xml);
      const [whole, closing, name, attrs, selfClosing] = tag ?? [];
      if (!tag || name![0] === "!" || (closing && attrs! + selfClosing)) return false;
      at = RELS_TAG.lastIndex;
      if (closing) continue;
      for (const [, key, double, single] of attrs!.matchAll(RELS_ATTR)) {
        if (key !== "xmlns" && !key!.startsWith("xmlns:")) continue;
        const prefix = key!.slice(6);
        const uri = double ?? single!;
        if ((namespaces.get(prefix) ?? uri) !== uri) return false;
        namespaces.set(prefix, uri);
      }
      // `mammoth` names an element it does not know by its namespace and local name.
      const colon = name!.indexOf(":");
      const prefix = name!.slice(0, Math.max(colon, 0));
      seen.add(`${namespaces.get(prefix) ?? prefix} ${name!.slice(colon + 1)}`);
      if (NAMED_TAG.test(name!)) seen.add(whole!);
      if (seen.size > MAX_MARKUP) return false;
    }
    return true;
  };
  for (const [path, reads] of (files && mammothParts(files))?.parsed ?? []) {
    const entry = files!.get(path);
    if (entry?.dir !== false) continue;
    const content = inflate(entry, Math.floor(left / reads));
    if (!content)
      throw new Error(
        `The document's XML expands to more than ${MAX_PARSED_XML_BYTES >> 20} MB, more than this reader takes.`,
      );
    left -= content.length * reads;
    // Decoded as `mammoth` decodes it; a byte-order mark is no `<`.
    if (!readable(content.toString())) throw new Error(UNREADABLE_DOCX);
  }
}

function luminance(hex: string) {
  const channel = (offset: number) => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(0) + 0.7152 * channel(2) + 0.0722 * channel(4);
}

const isHex = (value: string | null | undefined): value is string =>
  !!value && /^[0-9a-f]{6}$/i.test(value);

/** Contrast against white below 1.25:1 — white, or a grey too pale to read. */
const nearWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05) < 1.25;

/** XML quotes an attribute with either `"` or `'`; a hand-edited file uses the second. */
const attr = (attrs: string, name: string) => {
  const match = new RegExp(`w:${name}=(?:"([^"]*)"|'([^']*)')`).exec(attrs);
  return match ? (match[1] ?? match[2]!) : null;
};

/**
 * The colour a `w:shd` paints. Its pattern (`w:val`) lays `w:color` over `w:fill`: "clear" is the
 * fill alone, "solid" the colour alone, "pctN" N% of the colour over the fill. Any other pattern,
 * or an "auto" colour under one, is "" — unknown, and white text on it is not judged.
 */
function shading(attrs: string): string | null {
  const pattern = attr(attrs, "val") ?? "clear";
  const fill = attr(attrs, "fill");
  const color = attr(attrs, "color");
  if (pattern === "nil") return null;
  if (pattern === "clear") return isHex(fill) ? fill : null;
  if (pattern === "solid") return isHex(color) ? color : "";
  const percent = /^pct(\d+)$/.exec(pattern);
  if (!percent || !isHex(color)) return "";
  const under = isHex(fill) ? fill : "FFFFFF";
  const share = Math.min(Number(percent[1]), 100) / 100;
  return [0, 2, 4]
    .map((at) => {
      const channel = (hex: string) => parseInt(hex.slice(at, at + 2), 16);
      const mixed = Math.round(channel(color) * share + channel(under) * (1 - share));
      return mixed.toString(16).padStart(2, "0");
    })
    .join("");
}

/**
 * Every pattern over the XML stops at the next `<` as well as `>`: XML allows neither inside a
 * tag, and `[^>]*` let each unclosed tag in a hostile file scan to the end of the document —
 * quadratic in the 8 MB this reader accepts, and worse where two such runs were nested.
 */
const TAG = /<(\/?)(w:[A-Za-z]+|wps:txbx|v:textbox)\b([^<>]*?)(\/?)>/g;
const EXTENT = /<wp:extent\b([^<>]*)>/g;

/** A drawing's printed size is in EMUs: 12,700 to the point. */
const EMU_PER_POINT = 12_700;
const PHOTO_MIN_POINTS = 50;

export type DocxMeasure = {
  hiddenChars: number;
  hiddenSample: string;
  /** All of the hidden text, in document order, to `MAX_HIDDEN_TEXT` characters. */
  hiddenText: string;
  /** Tables in the body, nested ones included: Word layouts built from tables extract out of order. */
  tableCount: number;
  /** Pictures printed at least 50pt a side — a photo, as for a PDF. */
  imageCount: number;
  /** Tracked changes left in the main document and its headers and footers. */
  trackedChanges: number;
  /** Comments: those in the comments part, else the references to them in the document. */
  comments: number;
};

/**
 * A tracked change: an insertion, a deletion, a move, or a formatting change (`w:rPrChange`,
 * `w:pPrChange`, …). Not the range marks around a move (`w:moveFromRangeStart`), deleted text
 * (`w:delText`) or a table's inside borders (`w:insideH`): the name must end where the tag name
 * does. Bounded, so each `<w:` costs a constant.
 */
const REVISION = /<w:(?:ins|del|moveFrom|moveTo|[A-Za-z]{1,12}Pr(?:Ex)?Change)(?=[\s/>])/g;
const COMMENT = /<w:comment(?=[\s/>])/g;
const COMMENT_REFERENCE = /<w:commentReference(?=[\s/>])/g;
const count = (xml: string, pattern: RegExp) => xml.match(pattern)?.length ?? 0;

const MARKUP_OPEN = /<(?:!--|!\[CDATA\[|\?)/g;
const MARKUP_CLOSE = new Map([
  ["<!--", "-->"],
  ["<![CDATA[", "]]>"],
  ["<?", "?>"],
]);

/**
 * XML without its comments, processing instructions and CDATA markup, which an XML parser reads
 * as no elements: a tag written inside them is not one. A CDATA section's text stays, escaped as
 * the text around it is. One that never closes ends the document, as it ends what a parser
 * reads. Linear: each search starts where the last one ended.
 */
function withoutMarkup(xml: string): string {
  const kept: string[] = [];
  let at = 0;
  MARKUP_OPEN.lastIndex = 0;
  for (let match = MARKUP_OPEN.exec(xml); match; match = MARKUP_OPEN.exec(xml)) {
    kept.push(xml.slice(at, match.index));
    const start = match.index + match[0].length;
    const close = MARKUP_CLOSE.get(match[0])!;
    const end = xml.indexOf(close, start);
    if (end < 0) return kept.join("");
    if (match[0] === "<![CDATA[")
      kept.push(
        xml.slice(start, end).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"),
      );
    at = MARKUP_OPEN.lastIndex = end + close.length;
  }
  kept.push(xml.slice(at));
  return kept.join("");
}

/** A table being read; `outer` is what an unshaded cell of it shows, from the tables around it. */
type OpenTable = {
  styled: boolean;
  fill: string | null;
  cell: string | null;
  outer: string | null | undefined;
};

/**
 * The shading under text in `table` when its runs have none: its cell's, else its own, else —
 * unknown in a styled table — that of the tables around it. Undefined: none, the page shows.
 */
const underTable = (table: OpenTable | undefined): string | null | undefined =>
  table && (table.cell ?? table.fill ?? (table.styled ? null : table.outer));

/** What `measureDocx` throws for a main document too large to measure. */
export const UNMEASURABLE_DOCX = `The document's text expands to more than ${MAX_XML_BYTES / 1024 / 1024} MB; it is not a resume.`;

/** The most hidden text kept whole, in characters. */
export const MAX_HIDDEN_TEXT = 5_000;

/** XML text with its entity references decoded, as a parser gives it. */
const xmlText = (text: string) =>
  text.replace(/&#?\w+;/g, (reference) => entity(reference) ?? reference);

/**
 * The shading each paragraph style gives the paragraphs that name it: a hex colour, `null` for
 * none, or "" where its pattern leaves it unknown. Followed through `w:basedOn` (ten steps at
 * most). A style the part does not define is no style — Word gives its paragraph the defaults —
 * so it adds no shading. `xml` null: the part could not be read, and every style is unknown.
 */
function styleShading(xml: string | null): (id: string | null) => string | null {
  const styles = new Map<string, { shd: string | null | undefined; basedOn: string | null }>();
  for (let at = xml?.indexOf("<w:style ") ?? -1; xml && at >= 0;) {
    // A style written `<w:style …/>` is empty: what follows is the next style's.
    const open = xml.indexOf(">", at);
    const end = xml[open - 1] === "/" ? open + 1 : xml.indexOf("</w:style>", at);
    if (open < 0 || end < 0) break;
    const style = xml.slice(at, end);
    const id = attr(/^<w:style\b([^<>]*)>/.exec(style)?.[1] ?? "", "styleId");
    const shd = /<w:shd\b([^<>]*)>/.exec(style);
    const basedOn = /<w:basedOn\b([^<>]*)>/.exec(style);
    if (id)
      styles.set(id, {
        shd: shd ? shading(shd[1]!) : undefined,
        basedOn: basedOn ? attr(basedOn[1]!, "val") : null,
      });
    at = xml.indexOf("<w:style ", end);
  }
  return (id) => {
    if (xml === null) return "";
    for (let step = 0; id !== null && step < 10; step += 1) {
      const style = styles.get(id);
      if (!style) return null;
      if (style.shd !== undefined) return style.shd;
      id = style.basedOn;
    }
    // A chain that loops (A based on B based on A) or runs on past ten steps names no shading
    // Word would show: the page shows.
    return null;
  };
}

/**
 * A part's content, or null where it is damaged — which `mammoth` refuses on its own. Throws
 * `UNMEASURABLE_DOCX` where it expands past what this reads.
 */
function inflatePart(entry: ZipEntry): Buffer | null {
  const content = inflate(entry, MAX_XML_BYTES);
  if (content) return content;
  let large = entry.body.length > MAX_XML_BYTES;
  if (entry.method === 8)
    try {
      inflateRawSync(entry.body, { maxOutputLength: MAX_XML_BYTES });
    } catch (error) {
      large = (error as { code?: unknown }).code === "ERR_BUFFER_TOO_LARGE";
    }
  if (large) throw new Error(UNMEASURABLE_DOCX);
  return null;
}

/** What a part's runs say: the text of its hidden ones, and its paragraphs' text without the
 * runs marked hidden (`w:vanish`), a tab, break or carriage return each as a tab or line break. */
type PartRuns = { hidden: string[]; lines: string[] };

/**
 * Reads the runs of one part — the main document, a header, a footer — for those a reader of
 * the page cannot see. `page` is the page colour and `behindText` whether a shape lies behind
 * the text, both from the main document.
 */
function scanRuns(
  xml: string,
  paragraphStyle: (id: string | null) => string | null,
  page: string,
  behindText: boolean,
): PartRuns {
  // One entry per open table: whether it names a table style, whose shading this does not read,
  // the shading its own properties give every cell, and the shading of its current cell. Kept per
  // table, not once: a table nested in a cell closes back into that cell, and a cell of its own
  // without shading shows the cell around it. Only the innermost table changes while it is open,
  // so what the tables around it show is taken once, when it opens: a run resolves its
  // background in constant time however deep the nesting.
  const tables: OpenTable[] = [];
  let paragraphFill: string | null = null;
  // The shading of the paragraph style the paragraph names: a heading band is often given one.
  let styleFill: string | null = null;
  let inTextBox = 0;
  // The tracked formatting change (`w:rPrChange`, `w:pPrChange`, `w:tcPrChange`, …) being read:
  // the properties there are what the text looked like before the change, not what it looks
  // like. It ends with its own end tag, and at the latest where a run or paragraph opens, which
  // none holds: a change left open cannot hide the rest of the document.
  let change: string | null = null;
  let where: "table" | "cell" | "paragraph" | "run" | null = null;
  let run: {
    vanish: boolean;
    size: number | null;
    color: string | null;
    fill: string | null;
  } | null = null;
  let inText = false;
  let textStart = 0;
  let runText = "";
  let line = "";
  const hidden: string[] = [];
  const lines: string[] = [];

  for (const match of xml.matchAll(TAG)) {
    const [, closing, tag, attrs, selfClosing] = match;
    const open = !closing;

    if (inText && closing && tag === "w:t") {
      runText += xml.slice(textStart, match.index);
      inText = false;
      continue;
    }

    if (open && !selfClosing && (tag === "w:r" || tag === "w:p")) change = null;
    if (/^w:\w+Pr(?:Ex)?Change$/.test(tag)) {
      if (open && !selfClosing) change ??= tag;
      else if (closing && tag === change) change = null;
    } else if (change) continue;
    else if (tag === "wps:txbx" || tag === "v:textbox") inTextBox += open ? 1 : -1;
    else if (tag === "w:tbl" && !selfClosing) {
      if (open)
        tables.push({ styled: false, fill: null, cell: null, outer: underTable(tables.at(-1)) });
      else tables.pop();
    } else if (tag === "w:tblStyle" && tables.length) tables[tables.length - 1].styled = true;
    else if (tag === "w:tc" && open && tables.length) tables[tables.length - 1].cell = null;
    else if (tag === "w:p" && open && !selfClosing) paragraphFill = styleFill = null;
    else if (tag === "w:p" && closing) {
      lines.push(line);
      line = "";
    } else if (tag === "w:pStyle" && where === "paragraph")
      styleFill = paragraphStyle(attr(attrs, "val"));
    else if (tag === "w:tblPr") where = open && !selfClosing ? "table" : null;
    else if (tag === "w:tcPr") where = open && !selfClosing ? "cell" : null;
    else if (tag === "w:pPr") where = open && !selfClosing ? "paragraph" : null;
    else if (tag === "w:rPr") where = open && !selfClosing ? "run" : null;
    else if (tag === "w:shd" || tag === "w:highlight") {
      // Shading is hex, or "" where its pattern leaves it unknown; a highlight is a named colour,
      // where only "white" leaves the page white.
      const value = tag === "w:highlight" ? attr(attrs, "val") : null;
      const colour =
        tag === "w:shd"
          ? shading(attrs)
          : value === "white"
            ? "FFFFFF"
            : value && value !== "none"
              ? "000000"
              : null;
      if (colour !== null) {
        if (where === "table" && tables.length) tables[tables.length - 1].fill = colour;
        else if (where === "cell" && tables.length) tables[tables.length - 1].cell = colour;
        else if (where === "paragraph") paragraphFill = colour;
        else if (where === "run" && run) run.fill = colour;
      }
    } else if (tag === "w:r" && open && !selfClosing) {
      run = { vanish: false, size: null, color: null, fill: null };
      runText = "";
    } else if (tag === "w:r" && closing && run) {
      // A cell without shading of its own shows its table's, and a table nested in a cell
      // without either shows that cell's, outwards. In a styled table with neither, the style
      // may shade the cell: unknown. So is the bare page under a shape behind the text.
      const underCell = underTable(tables.at(-1));
      const background =
        run.fill ??
        paragraphFill ??
        styleFill ??
        (underCell === undefined ? (behindText ? null : page) : underCell);
      const whiteOnWhite =
        !inTextBox &&
        isHex(run.color) &&
        nearWhite(run.color) &&
        isHex(background) &&
        nearWhite(background);
      const tiny = run.size !== null && run.size < 4;
      if (runText.trim() && (run.vanish || tiny || whiteOnWhite)) hidden.push(runText);
      if (!run.vanish) line += runText;
      run = null;
    } else if (run && where === "run") {
      if (tag === "w:vanish") run.vanish = !/^(?:0|false|off)$/.test(attr(attrs, "val") ?? "");
      else if (tag === "w:sz") run.size = Number(attr(attrs, "val")) || null;
      else if (tag === "w:color") run.color = attr(attrs, "val");
    } else if (tag === "w:t" && open && !selfClosing) {
      inText = true;
      textStart = match.index + match[0].length;
    } else if (run && open && (tag === "w:tab" || tag === "w:br" || tag === "w:cr"))
      runText += tag === "w:tab" ? "\t" : "\n";
  }
  return { hidden, lines };
}

/** The parts holding a DOCX's page headers and footers, by name. */
const marginParts = (files: Map<string, ZipEntry>) =>
  [...files]
    .filter(([key, entry]) => HEADER_OR_FOOTER.test(key) && !entry.dir)
    .sort(([a], [b]) => (a < b ? -1 : 1));

/**
 * Hidden runs, tables and pictures in a DOCX's main document, or null when it has none to read.
 * The runs of its page headers and footers are judged too: an ATS reads them as well. Throws
 * `UNMEASURABLE_DOCX` when the document or its styles are there but expand past what this reads:
 * its text would still reach an ATS — padded past the limit with an XML comment — while every
 * rule that depends on these measures silently dropped out of the report.
 */
export function measureDocx(data: Uint8Array): DocxMeasure | null {
  // The main document `mammoth` extracts, wherever the package's relationships put it.
  const files = zipFiles(data);
  const parts = files && mammothParts(files);
  const entry = parts && files.get(parts.main);
  if (!entry || entry.dir) return null;
  const content = inflatePart(entry);
  if (!content?.length) return null;
  const xml = withoutMarkup(content.toString("utf8"));
  const stylesEntry = parts.styles ? files.get(parts.styles) : undefined;
  const styles = stylesEntry && inflatePart(stylesEntry);
  const paragraphStyle = styleShading(
    styles ? withoutMarkup(styles.toString("utf8")) : stylesEntry ? null : "",
  );

  const tableCount = xml.match(/<w:tbl>|<w:tbl\s/g)?.length ?? 0;
  // Pictures, not every drawing: a text box or a shape has an extent too, and a skills text box
  // was reported as a photo.
  let imageCount = 0;
  for (let at = xml.indexOf("<w:drawing"); at >= 0;) {
    const end = xml.indexOf("</w:drawing>", at);
    const drawing = xml.slice(at, end < 0 ? xml.length : end);
    if (
      /<(?:pic:pic|a:blip)\b/.test(drawing) &&
      [...drawing.matchAll(EXTENT)].some(([, attrs]) =>
        [/\bcx=["'](\d+)["']/, /\bcy=["'](\d+)["']/].every(
          (size) => Number(size.exec(attrs!)?.[1] ?? 0) / EMU_PER_POINT >= PHOTO_MIN_POINTS,
        ),
      )
    )
      imageCount += 1;
    at = end < 0 ? -1 : xml.indexOf("<w:drawing", end);
  }

  // The page colour, when the document sets one and shows it.
  const page = /<w:background\b[^<>]*w:color=["']([0-9A-Fa-f]{6})["']/.exec(xml)?.[1] ?? "FFFFFF";
  // A shape anchored behind the text — a Word template's dark sidebar or header band — lies
  // under text this cannot place, so text on the bare page no longer has a known background.
  const behindText = /<wp:anchor\b[^<>]*\bbehindDoc=["'](?:1|true|on)["']/.test(xml);

  const hidden = scanRuns(xml, paragraphStyle, page, behindText).hidden;
  let trackedChanges = count(xml, REVISION);
  // A header's banner — a shape or picture behind its text, as Word's templates draw them — is
  // a background this cannot read: white text on the bare page of a part that draws one is not
  // judged.
  for (const [, margin] of marginParts(files)) {
    const part = inflate(margin, MAX_XML_BYTES);
    if (!part) continue;
    const content = withoutMarkup(part.toString("utf8"));
    trackedChanges += count(content, REVISION);
    const drawn = behindText || /<w:(?:drawing|pict)\b/.test(content);
    for (const run of scanRuns(content, paragraphStyle, page, drawn).hidden) hidden.push(run);
  }

  // The comments themselves, from their own part when it is there to read.
  const commentsEntry = parts.comments ? files.get(parts.comments) : undefined;
  const commentsPart = commentsEntry && inflate(commentsEntry, MAX_XML_BYTES);
  const comments = Math.max(
    commentsPart ? count(withoutMarkup(commentsPart.toString("utf8")), COMMENT) : 0,
    count(xml, COMMENT_REFERENCE),
  );

  const decoded = xmlText(hidden.join(" ").replace(/\s+/g, " ").trim());
  return {
    hiddenText: decoded.slice(0, MAX_HIDDEN_TEXT),
    hiddenChars: decoded.replace(/\s/g, "").length,
    hiddenSample: decoded.slice(0, 80),
    tableCount,
    imageCount,
    trackedChanges,
    comments,
  };
}

/**
 * The text of a DOCX's page headers and footers, one line per paragraph or line break, each line
 * once: what `mammoth` leaves out. Contact details often sit in the header, and an ATS that reads
 * headers finds them there. Page numbers, and runs marked hidden, are left out.
 */
export function docxMargins(data: Uint8Array): { header: string; footer: string } {
  const lines = { header: new Set<string>(), footer: new Set<string>() };
  for (const [key, entry] of marginParts(zipFiles(data) ?? new Map())) {
    const content = inflate(entry, MAX_XML_BYTES);
    if (!content) continue;
    const { lines: paragraphs } = scanRuns(
      withoutMarkup(content.toString("utf8")),
      () => null,
      "FFFFFF",
      false,
    );
    for (const paragraph of paragraphs)
      for (let line of xmlText(paragraph).split("\n")) {
        line = line.trim();
        if (line && !/^\d+$/.test(line))
          lines[key.includes("header") ? "header" : "footer"].add(line);
      }
  }
  return { header: [...lines.header].join("\n"), footer: [...lines.footer].join("\n") };
}

/**
 * The HTML a DOCX embeds whole (`w:altChunk`), as html-docx-js and many web resume builders
 * write it: the document then holds no paragraphs of its own, and `mammoth` read it as empty.
 * An MHT chunk — the form html-docx-js writes — is read from its `<html` to its `</html>`,
 * quoted-printable decoded when it says so; RTF and other chunks are left out.
 */
export function docxChunks(data: Uint8Array): string[] {
  const files = zipFiles(data);
  const parts = files && mammothParts(files);
  return (parts?.chunks ?? []).flatMap((chunk) => {
    let content = inflate(files!.get(chunk)!, MAX_XML_BYTES)?.toString("latin1") ?? "";
    if (/^MIME-Version:[^]*quoted-printable/i.test(content.slice(0, 2_000)))
      content = content
        .replace(/=\r?\n/g, "")
        .replace(/=([0-9A-F]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    const start = content.search(/<html\b/i);
    const end = content.lastIndexOf("</html>");
    return start < 0
      ? []
      : [
          Buffer.from(content.slice(start, end < 0 ? undefined : end + 7), "latin1").toString(
            "utf8",
          ),
        ];
  });
}
