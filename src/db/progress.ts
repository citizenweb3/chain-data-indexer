import { getPool } from './pg.js';

export async function getLastBlock(): Promise<number> {
  const pool = getPool();
  const { rows } = await pool.query<{ last_block: string }>(
    'SELECT last_block FROM miden_indexer_progress WHERE id = 1',
  );
  return rows.length ? Number(rows[0].last_block) : -1;
}

export async function setLastBlock(blockNum: number): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO miden_indexer_progress (id, last_block, updated_at)
       VALUES (1, $1, now())
     ON CONFLICT (id) DO UPDATE
       SET last_block = GREATEST(miden_indexer_progress.last_block, EXCLUDED.last_block),
           updated_at = now()`,
    [blockNum],
  );
}
