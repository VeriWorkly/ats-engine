/**
 * Compiles a pattern a policy carries, always in Unicode mode.
 *
 * Unicode mode is what makes `\p{L}` and friends available to policy authors, so a heading or a
 * degree pattern can be written for German or Hindi as easily as for English. It is also
 * stricter: an escape of a character that needs none (`\-` outside a class, `\'`) is a syntax
 * error rather than a literal. `parseAtsPolicy` compiles every pattern this way, so a policy that
 * passes validation cannot fail here. A `v` flag already implies Unicode mode and is left alone.
 *
 * A group name used twice is refused on every engine. Node 24 accepts one per alternative
 * (ES2025); Node 22, and older browsers, throw. A policy built on the newer engine would
 * otherwise pass validation there and fail on the first resume read on an older one.
 */
export function policyRegex(pattern: string, flags = "") {
  const repeated = repeatedGroupName(pattern);
  if (repeated !== null)
    throw new SyntaxError(`Invalid regular expression: duplicate capture group name "${repeated}"`);
  return new RegExp(pattern, /[uv]/.test(flags) ? flags : `${flags}u`);
}

const NAME_CHAR = /[\p{ID_Continue}$\u{200C}\u{200D}]/u;

/** The first capture-group name the pattern declares twice, or null. One pass, linear. */
export function repeatedGroupName(pattern: string): string | null {
  const seen = new Set<string>();
  let inClass = false;
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === "\\") {
      i += 1;
      continue;
    }
    if (inClass) {
      if (char === "]") inClass = false;
      continue;
    }
    if (char === "[") inClass = true;
    // "(?<name>", not a lookbehind "(?<=" or "(?<!".
    if (char !== "(" || pattern[i + 1] !== "?" || pattern[i + 2] !== "<") continue;
    let end = i + 3;
    while (end < pattern.length && NAME_CHAR.test(pattern[end]!)) end += 1;
    if (end === i + 3 || pattern[end] !== ">") continue;
    const name = pattern.slice(i + 3, end);
    if (seen.has(name)) return name;
    seen.add(name);
    i = end;
  }
  return null;
}
