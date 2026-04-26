import { getPool } from './pg.js';

export async function getLastSlot(): Promise<number> {
  const pool = getPool();
  const { rows } = await pool.query<{ last_slot: string }>(
    "SELECT last_slot FROM logos_indexer_progress WHERE id = 'default'",
  );
  return rows.length ? Number(rows[0].last_slot) : 0;
}

export async function setLastSlot(
  slot: number,
  height: number | null,
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE logos_indexer_progress
        SET last_slot = $1, last_height = $2, updated_at = now()
      WHERE id = 'default'`,
    [slot, height],
  );
}
