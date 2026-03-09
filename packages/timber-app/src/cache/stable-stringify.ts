/**
 * Deterministic JSON serialization with sorted object keys.
 * Used for cache key generation — ensures { a: 1, b: 2 } and { b: 2, a: 1 }
 * produce the same string.
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value);
  if (typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map((item) => stableStringify(item)).join(',') + ']';
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs: string[] = [];
  for (const key of keys) {
    if (obj[key] === undefined) continue;
    pairs.push(JSON.stringify(key) + ':' + stableStringify(obj[key]));
  }
  return '{' + pairs.join(',') + '}';
}
