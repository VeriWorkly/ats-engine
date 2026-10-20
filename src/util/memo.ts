/**
 * `compute`, run once per key object (the "compile once per policy" cache). The key must be the
 * object the value is derived from and must not be mutated afterwards (`deepFreeze`).
 */
export function memo<K extends object, V>(compute: (key: K) => V): (key: K) => V {
  const cache = new WeakMap<K, V>();
  return (key) => {
    if (cache.has(key)) return cache.get(key) as V;
    const value = compute(key);
    cache.set(key, value);
    return value;
  };
}

/**
 * `value` frozen deeply: shared policies and packs feed `memo`, so a later mutation would go
 * unread; frozen, it throws in strict mode instead. The type is unchanged.
 */
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
}
