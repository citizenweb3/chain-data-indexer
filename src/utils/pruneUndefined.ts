/**
 * Recursively removes all properties with `undefined` values from objects and arrays.
 * Preserves other values including nulls.
 * @param obj The object or array to prune.
 * @returns A new object or array with all `undefined` values removed.
 */
export function pruneUndefined<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((v) => pruneUndefined(v)).filter((v) => v !== undefined) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const pv = pruneUndefined(v as unknown);
    if (pv !== undefined) out[k] = pv;
  }
  return out as T;
}
