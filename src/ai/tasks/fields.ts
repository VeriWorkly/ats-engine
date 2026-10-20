import * as z from "zod/mini";

/** Lenient field parsers: nullable, optional, defaulting to empty; lengths stay bounded so an oversized reply fails and retries. */

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
