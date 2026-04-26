import { getPool } from '../db/pg.js';
import type { LogosBlock } from '../types.js';

export async function upsertBlock(block: LogosBlock): Promise<void> {
  const h = block.header;
  const pol = h.proof_of_leadership;

  // id is only present in blocks from /cryptarchia/blocks; absent in /storage/block
  if (!h.id) return;

  const pool = getPool();
  await pool.query(
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
}

export async function upsertBlocks(blocks: LogosBlock[]): Promise<void> {
  if (blocks.length === 0) return;
  // Sequential insert is fine for batch sizes ≤ 500
  for (const block of blocks) {
    await upsertBlock(block);
  }
}

export async function upsertLeader(
  leaderKey: string,
  slot: number,
): Promise<void> {
  const pool = getPool();
  await pool.query(
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

export async function processBlock(block: LogosBlock): Promise<void> {
  await upsertBlock(block);
  if (block.header.id) {
    await upsertLeader(
      block.header.proof_of_leadership.leader_key,
      block.header.slot,
    );
  }

  // TODO v0.2: when block.transactions[] is non-empty, parse mantle_tx objects
  // and insert into logos_transactions + logos_notes.
  // See docs/future.md for the planned schema and parsing logic.
}
