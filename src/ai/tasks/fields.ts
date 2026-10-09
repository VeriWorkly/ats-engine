import * as z from "zod/mini";

/**
 * Lenient field parsers for model output.
 *
 * Every field is nullable and optional and defaults to an empty value, so a model that leaves a
 * field out or answers `null` produces a sparse result rather than a failed request. Lengths and
 * counts stay bounded: an oversized reply is malformed, and failing it earns a retry.
 */

export const text = (maxLength: number) =>
  z.pipe(
    z.optional(z.nullable(z.string().check(z.maxLength(maxLength)))),
    z.transform((value) => value ?? ""),
  );

export const trimmedText = (maxLength: number) =>
  z.pipe(
    z.optional(z.nullable(z.string().check(z.maxLength(maxLength)))),
    z.transform((value) => value?.trim() ?? ""),
  );

export const flag = z.pipe(
  z.optional(z.nullable(z.boolean())),
  z.transform((value) => value ?? false),
);

export const list = <T extends z.ZodMiniType>(item: T, maxItems: number) =>
  z.pipe(
    z.optional(z.nullable(z.array(item).check(z.maxLength(maxItems)))),
    z.transform((value): z.output<T>[] => value ?? []),
  );

export const textList = (maxLength: number, maxItems: number) => list(text(maxLength), maxItems);
