/**
 * Compiles a policy pattern, always in Unicode mode (`\p{L}` for any script; stray escapes like
 * `\-` are errors). `parseAtsPolicy` compiles every pattern this way, so a validated one cannot
 * fail here. A `v` flag already implies Unicode mode.
 *
 * A repeated group name is refused on every engine: Node 24 accepts one per alternative
 * (ES2025), Node 22 and older browsers throw.
 */
export function policyRegex(pattern: string, flags = "") {
  const repeated = repeatedGroupName(pattern);
  if (repeated !== null)
    throw new SyntaxError(`Invalid regular expression: duplicate capture group name "${repeated}"`);
  return new RegExp(pattern, /[uv]/.test(flags) ? flags : `${flags}u`);
}

const NAME_CHAR = /[\p{ID_Continue}$\u{200C}\u{200D}]/u;

/** The first capture-group name the pattern declares twice, or null. */
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
    // "(?<name>", not a lookbehind.
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
