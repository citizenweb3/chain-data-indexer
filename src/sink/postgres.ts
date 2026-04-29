import pg from 'pg';
import { getPool } from '../db/pg.js';
import type { LogosBlock } from '../types.js';

type QueryRunner = pg.Pool | pg.PoolClient;

// ─── Internal helpers (accept either a pool or an in-progress client) ─────────

async function _upsertBlock(
  block: LogosBlock,
  qr: QueryRunner,
): Promise<boolean> {
  const h = block.header;
  const pol = h.proof_of_leadership;
  if (!h.id) return false;

  const result = await qr.query(
    `INSERT INTO logos_blocks
       (id, parent_block, slot, height, block_root, leader_key, voucher_cm, entropy, tx_count, raw)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (id) DO NOTHING`,
    [
      h.id,
      h.parent_block,
      h.slot,
      h.height ?? null,
      h.block_root,
      pol.leader_key,
      pol.voucher_cm,
      pol.entropy_contribution,
      block.transactions.length,
      JSON.stringify(block),
    ],
  );
  return result.rowCount === 1;
}

async function _upsertLeader(
  leaderKey: string,
  slot: number,
  qr: QueryRunner,
): Promise<void> {
  await qr.query(
    `INSERT INTO logos_leaders (leader_key, blocks_produced, first_block_slot, last_block_slot)
     VALUES ($1, 1, $2, $2)
     ON CONFLICT (leader_key) DO UPDATE SET
       blocks_produced  = logos_leaders.blocks_produced + 1,
       first_block_slot = LEAST(logos_leaders.first_block_slot, EXCLUDED.first_block_slot),
       last_block_slot  = GREATEST(logos_leaders.last_block_slot, EXCLUDED.last_block_slot),
       updated_at       = now()`,
    [leaderKey, slot],
  );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Process a single block atomically: insert block + update leader stats in one
 * transaction. Leader is only updated when the block is newly inserted (idempotent
 * on restart — avoids double-counting on re-processed slot ranges).
 */
export async function processBlock(block: LogosBlock): Promise<void> {
  if (!block.header.id) return;

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const inserted = await _upsertBlock(block, client);
    if (inserted) {
      await _upsertLeader(
        block.header.proof_of_leadership.leader_key,
        block.header.slot,
        client,
      );
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Process a batch of blocks in a single database transaction.
 * Uses unnest for a multi-row INSERT, then aggregates leader stats in one query.
 * Returns the number of newly inserted blocks.
 */
export async function processBatch(blocks: LogosBlock[]): Promise<number> {
  const valid = blocks.filter((b) => b.header.id);
  if (valid.length === 0) return 0;

  const ids         = valid.map((b) => b.header.id!);
  const parents     = valid.map((b) => b.header.parent_block);
  const slots       = valid.map((b) => b.header.slot);
  const heights     = valid.map((b) => b.header.height ?? null);
  const roots       = valid.map((b) => b.header.block_root);
  const leaderKeys  = valid.map((b) => b.header.proof_of_leadership.leader_key);
  const voucherCms  = valid.map((b) => b.header.proof_of_leadership.voucher_cm);
  const entropies   = valid.map((b) => b.header.proof_of_leadership.entropy_contribution);
  const txCounts    = valid.map((b) => b.transactions.length);
  const raws        = valid.map((b) => JSON.stringify(b));

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');

    // Multi-row insert; RETURNING gives us which rows were actually new
    const { rows: inserted } = await client.query<{ leader_key: string; slot: string }>(
      `INSERT INTO logos_blocks
         (id, parent_block, slot, height, block_root, leader_key, voucher_cm, entropy, tx_count, raw)
       SELECT * FROM unnest(
         $1::text[], $2::text[], $3::bigint[], $4::bigint[], $5::text[],
         $6::text[], $7::text[], $8::text[], $9::integer[], $10::jsonb[]
       ) AS t(id, parent_block, slot, height, block_root, leader_key, voucher_cm, entropy, tx_count, raw)
       ON CONFLICT (id) DO NOTHING
       RETURNING leader_key, slot`,
      [ids, parents, slots, heights, roots, leaderKeys, voucherCms, entropies, txCounts, raws],
    );

    if (inserted.length > 0) {
      // Aggregate per-leader counts/min/max from newly inserted rows, then upsert once
      const leaderStats = new Map<string, { count: number; minSlot: number; maxSlot: number }>();
      for (const row of inserted) {
        const s = Number(row.slot);
        const existing = leaderStats.get(row.leader_key);
        if (existing) {
          existing.count++;
          existing.minSlot = Math.min(existing.minSlot, s);
          existing.maxSlot = Math.max(existing.maxSlot, s);
        } else {
          leaderStats.set(row.leader_key, { count: 1, minSlot: s, maxSlot: s });
        }
      }

      const lKeys    = [...leaderStats.keys()];
      const lCounts  = lKeys.map((k) => leaderStats.get(k)!.count);
      const lMins    = lKeys.map((k) => leaderStats.get(k)!.minSlot);
      const lMaxs    = lKeys.map((k) => leaderStats.get(k)!.maxSlot);

      await client.query(
        `INSERT INTO logos_leaders (leader_key, blocks_produced, first_block_slot, last_block_slot)
         SELECT * FROM unnest($1::text[], $2::bigint[], $3::bigint[], $4::bigint[])
           AS t(leader_key, blocks_produced, first_block_slot, last_block_slot)
         ON CONFLICT (leader_key) DO UPDATE SET
           blocks_produced  = logos_leaders.blocks_produced + EXCLUDED.blocks_produced,
           first_block_slot = LEAST(logos_leaders.first_block_slot, EXCLUDED.first_block_slot),
           last_block_slot  = GREATEST(logos_leaders.last_block_slot, EXCLUDED.last_block_slot),
           updated_at       = now()`,
        [lKeys, lCounts, lMins, lMaxs],
      );
    }

    await client.query('COMMIT');
    return inserted.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Mark all blocks up to the given finalized height as finalized.
 * Called by the lib-stream follower when LIB advances.
 */
export async function markBlocksFinalized(upToHeight: number): Promise<number> {
  const pool = getPool();
  const result = await pool.query(
    `UPDATE logos_blocks SET finalized = true
     WHERE height <= $1 AND NOT finalized`,
    [upToHeight],
  );
  return result.rowCount ?? 0;
}
