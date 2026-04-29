import { getPool } from './pg.js';
import type pg from 'pg';

export async function getLastBlock(pool = getPool()): Promise<number> {
  const { rows } = await pool.query<{ last_block: string }>(
    'SELECT last_block FROM miden_indexer_progress WHERE id = 1',
  );
  return rows.length ? Number(rows[0].last_block) : -1;
}

export async function setLastBlock(blockNum: number, pool: pg.Pool = getPool()): Promise<void> {
  await pool.query(
    `INSERT INTO miden_indexer_progress (id, last_block, updated_at)
       VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE
       SET last_block = GREATEST(miden_indexer_progress.last_block, EXCLUDED.last_block),
           updated_at = now()`,
    [blockNum],
  );
}
