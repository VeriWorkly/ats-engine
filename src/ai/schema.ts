import * as z from "zod/mini";

/**
 * The strict JSON Schema sent to the model, generated from the lenient zod parse schema:
 * - every object lists all its properties as required and sets `additionalProperties: false`;
 * - optionality is carried by `null`, written as `type: [X, "null"]`;
 * - array items are non-null;
 * - length, size and range keywords are dropped (the parse schema still enforces them).
 */

type Node = Record<string, unknown>;

const CONSTRAINTS = [
  "minLength",
  "maxLength",
  "minItems",
  "maxItems",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "pattern",
  "format",
  "default",
];

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function withoutNull(node: Node): Node {
  const type = node.type;
  if (!Array.isArray(type)) return node;
  const rest = type.filter((entry) => entry !== "null");
  return { ...node, type: rest.length === 1 ? rest[0] : rest };
}

function tighten(input: Node): Node {
  const node: Node = { ...input };
  for (const key of CONSTRAINTS) delete node[key];

  // `anyOf: [X, { type: "null" }]` → X with "null" added to its type.
  const anyOf = node.anyOf;
  if (Array.isArray(anyOf) && anyOf.length === 2 && anyOf.every(isNode)) {
    const nullIndex = anyOf.findIndex((branch) => branch.type === "null");
    const other = anyOf[1 - nullIndex];
    if (nullIndex !== -1 && typeof other.type === "string") {
      delete node.anyOf;
      return { ...node, ...tighten(other), type: [other.type, "null"] };
    }
  }

  if (isNode(node.properties)) {
    const properties = Object.fromEntries(
      Object.entries(node.properties).map(([key, child]) => [key, tighten(child as Node)]),
    );
    node.properties = properties;
    node.required = Object.keys(properties);
    node.additionalProperties = false;
  }
  if (isNode(node.items)) node.items = withoutNull(tighten(node.items));
  return node;
}

export function toStrictJsonSchema(schema: z.ZodMiniType): Record<string, unknown> {
  const generated = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" }) as Node;
  delete generated.$schema;
  return tighten(generated);
}
