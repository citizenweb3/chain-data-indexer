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
    `INSERT INTO logos_indexer_progress (id, last_slot, last_height, updated_at)
       VALUES ('default', $1, $2, now())
     ON CONFLICT (id) DO UPDATE
       SET last_slot   = GREATEST(logos_indexer_progress.last_slot, EXCLUDED.last_slot),
           last_height = EXCLUDED.last_height,
           updated_at  = now()`,
    [slot, height],
  );
}
