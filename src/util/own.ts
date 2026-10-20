/** A record's own value for `key`; `record[word]` would also read `Object.prototype`. */
export function own<T>(record: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}
