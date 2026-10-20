import { normalizeText } from "../text/text.js";
import { ENGLISH_ISSUES } from "../util/issues.js";
import { deepFreeze } from "../util/memo.js";
import { AtsPolicyError, type AtsPolicyIssue } from "./errors.js";
import { atsEngineSchema, type AtsEnginePolicy } from "./schema.js";

/** How deep a policy may nest; the schema itself nests six levels. */
const MAX_POLICY_DEPTH = 5_000;

/**
 * Every string in the policy, and every object key, in the form resume text is normalised to
 * (`normalizeText`), so a precomposed Hindi "ज़" matches the decomposed text.
 *
 * Iterative, so a policy nested past `MAX_POLICY_DEPTH` or containing itself is refused as
 * invalid instead of overflowing the stack. Two keys that normalise to one keep the first
 * one's place and the last one's value.
 */
function normalizeStrings(json: unknown): unknown {
  const root: Record<PropertyKey, unknown> = {};
  // [target object, key, value, depth]; a task with no target marks leaving an object.
  const stack: [Record<PropertyKey, unknown> | null, PropertyKey, unknown, number][] = [
    [root, 0, json, 0],
  ];
  const path = new Set<unknown>();
  for (let task; (task = stack.pop());) {
    const [target, key, value, depth] = task;
    if (!target) path.delete(value);
    else if (!value || typeof value !== "object")
      target[key] = typeof value === "string" ? normalizeText(value) : value;
    else {
      if (depth === MAX_POLICY_DEPTH || path.has(value))
        throw invalid([
          {
            path: "",
            message: path.has(value)
              ? "Contains itself."
              : `Nested deeper than ${MAX_POLICY_DEPTH} levels.`,
          },
        ]);
      path.add(value);
      stack.push([null, 0, value, 0]);
      const array = Array.isArray(value);
      // An array's entries skip its holes; an object's keys are normalised.
      const entries: [PropertyKey, unknown][] = array
        ? value.flatMap((item, index) => [[index, item]])
        : Object.entries(value).map(([name, item]) => [normalizeText(name), item]);
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

/** Validates a policy and returns it frozen, or throws `AtsPolicyError`. Pure: caching is the host's. */
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
