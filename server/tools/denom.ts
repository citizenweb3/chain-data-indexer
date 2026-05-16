export const UNKNOWN_DENOM = '__unknown__';

const TRACE_PREFIX = /^transfer\/[^/]+\//;
const MAX_HOPS = 16;

export const resolveBaseDenom = (raw: string | null | undefined): string => {
  if (raw === null || raw === undefined) return UNKNOWN_DENOM;
  const trimmed = raw.trim();
  if (trimmed === '') return UNKNOWN_DENOM;

  let current = trimmed;
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    if (!TRACE_PREFIX.test(current)) return current;
    current = current.replace(TRACE_PREFIX, '');
  }
  return current;
};
