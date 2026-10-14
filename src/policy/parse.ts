import { normalizeText } from "../text/text.js";
import { ENGLISH_ISSUES } from "../util/issues.js";
import { deepFreeze } from "../util/memo.js";
import { AtsPolicyError, type AtsPolicyIssue } from "./errors.js";
import { atsEngineSchema, type AtsEnginePolicy } from "./schema.js";

/**
 * How deep a policy may nest. The schema nests six levels; this is far past that, and past where
 * the recursive walk this replaced ran out of stack (2,000 to 7,000 levels, by runtime and
 * warm-up), so a policy refused here could not have been read before either.
 */
const MAX_POLICY_DEPTH = 5_000;

/**
 * Every string in the policy in the form resume text is normalised to (`normalizeText`), so a
 * word written with a precomposed character — Hindi "ज़" — matches the decomposed text it will
 * be compared with. Object keys too: month names are keys.
 *
 * A loop over a stack rather than recursion, so a policy nested deeper than `MAX_POLICY_DEPTH`
 * (or one that contains itself) is refused as invalid instead of overflowing the stack. It
 * visits values in the order the recursion did, and two keys that normalise to one still keep
 * the first one's place and the last one's value.
 */
function normalizeStrings(json: unknown): unknown {
  const root: Record<PropertyKey, unknown> = {};
  // Where a value's normalised form goes, the value, and how many objects and arrays hold it.
  const stack: [Record<PropertyKey, unknown>, PropertyKey, unknown, number][] = [
    [root, 0, json, 0],
  ];
  for (let task; (task = stack.pop());) {
    const [target, key, value, depth] = task;
    if (!value || typeof value !== "object")
      target[key] = typeof value === "string" ? normalizeText(value) : value;
    else {
      if (depth === MAX_POLICY_DEPTH)
        throw invalid([{ path: "", message: `Nested deeper than ${MAX_POLICY_DEPTH} levels.` }]);
      const array = Array.isArray(value);
      // An array's entries skip its holes, as `map` did; an object's keys are normalised.
      const entries: [PropertyKey, unknown][] = array
        ? value.flatMap((item, index) => [[index, item]])
        : Object.entries(value).map(([name, item]) => [normalizeText(name), item]);
      // An object's keys in first-seen order, as `Object.fromEntries` places them; values below.
      const out = (array ? new Array(value.length) : Object.fromEntries(entries)) as typeof root;
      target[key] = out;
      for (let index = entries.length; index--;)
        stack.push([out, entries[index][0], entries[index][1], depth + 1]);
    }
  }
  return root[0];
}

const invalid = (issues: AtsPolicyIssue[]) =>
  new AtsPolicyError("ATS engine policy is invalid.", issues);

/**
 * Validates a policy and returns it, or throws `AtsPolicyError`.
 *
 * Pure by design. Caching a policy is a host concern — the host knows where the JSON comes from
 * and when it changes — so this function does exactly what its signature says and nothing more.
 */
export function parseAtsPolicy(json: unknown): AtsEnginePolicy {
  const result = atsEngineSchema.safeParse(normalizeStrings(json), ENGLISH_ISSUES);
  if (result.success) return deepFreeze(result.data);

  throw invalid(
    result.error.issues.map((issue) => ({
      path: issue.path.map(String).join("."),
      message: issue.message,
    })),
  );
}
