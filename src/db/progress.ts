import { getPool } from './pg.js';

export async function getLastBlock(): Promise<number> {
  const pool = getPool();
  const { rows } = await pool.query<{ last_block_num: string }>(
    "SELECT last_block_num FROM miden_indexer_progress WHERE id = 'default'",
  );
  return rows.length ? Number(rows[0].last_block_num) : 0;
}

export async function setLastBlock(blockNum: number): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO miden_indexer_progress (id, last_block_num, updated_at)
       VALUES ('default', $1, now())
     ON CONFLICT (id) DO UPDATE
       SET last_block_num = GREATEST(miden_indexer_progress.last_block_num, EXCLUDED.last_block_num),
           updated_at = now()`,
    [blockNum],
  );
}
