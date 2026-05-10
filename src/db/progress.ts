import { getPool } from './pg.js';
import { observeFlush, setIndexedHeight } from '../metrics/registry.js';

export interface ProgressState {
  lastHeight: number;
  lastHash: string | null;
  updatedAt: Date | null;
}

export async function getProgress(): Promise<ProgressState> {
  const pool = getPool();
  const { rows } = await pool.query<{ last_height: string; last_hash: string | null; updated_at: Date | null }>(
    "SELECT last_height::text, last_hash, updated_at FROM monero_indexer_progress WHERE id = 'default'",
  );

  if (rows.length === 0) {
    return { lastHeight: -1, lastHash: null, updatedAt: null };
  }

  return {
    lastHeight: Number(rows[0].last_height),
    lastHash: rows[0].last_hash,
    updatedAt: rows[0].updated_at,
  };
}

export async function getLastHeight(): Promise<number> {
  return (await getProgress()).lastHeight;
}

export async function getMaxCanonicalHeight(): Promise<number | null> {
  const pool = getPool();
  const { rows } = await pool.query<{ max_height: string | null }>(
    'SELECT MAX(height)::text AS max_height FROM monero_blocks WHERE is_canonical',
  );
  return rows[0]?.max_height === null || rows[0]?.max_height === undefined
    ? null
    : Number(rows[0].max_height);
}

export async function setProgress(height: number, hash: string | null): Promise<void> {
  const pool = getPool();
  const start = process.hrtime.bigint();
  await pool.query(
    `INSERT INTO monero_indexer_progress (id, last_height, last_hash, updated_at)
       VALUES ('default', $1, $2, now())
     ON CONFLICT (id) DO UPDATE
       SET last_height = GREATEST(monero_indexer_progress.last_height, EXCLUDED.last_height),
           last_hash = CASE
             WHEN EXCLUDED.last_height > monero_indexer_progress.last_height THEN EXCLUDED.last_hash
             WHEN EXCLUDED.last_height = monero_indexer_progress.last_height
               AND EXCLUDED.last_hash IS DISTINCT FROM monero_indexer_progress.last_hash
               THEN EXCLUDED.last_hash
             ELSE monero_indexer_progress.last_hash
           END,
           updated_at = now()`,
    [height, hash],
  );

  observeFlush('progress', Number(process.hrtime.bigint() - start) / 1_000_000_000, {
    monero_indexer_progress: 1,
  });
  setIndexedHeight(height);
}
