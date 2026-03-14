export function getTriggeredFlushBuffers<Key extends string>(
  counts: Record<Key, number>,
  thresholds: Partial<Record<Key, number | undefined>>,
): Key[] {
  const triggeredBy: Key[] = [];

  for (const key of Object.keys(counts) as Key[]) {
    const threshold = thresholds[key];
    if (!threshold || threshold <= 0) {
      continue;
    }

    if (counts[key] >= threshold) {
      triggeredBy.push(key);
    }
  }

  return triggeredBy;
}
