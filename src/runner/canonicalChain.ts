import { config } from '../config.js';
import { getPool } from '../db/pg.js';
import { observeFlush } from '../metrics/registry.js';
import { fetchBlockHeaderByHeight } from '../rpc/client.js';
import { logger } from '../utils/logger.js';
import type { MoneroBlockHeader } from '../types.js';

interface StoredCanonicalRow {
  height: string;
  hash: string;
}

export interface CanonicalPoint {
  height: number;
  hash: string;
}

const COMMON_ANCESTOR_PAGE_SIZE = 128;

export async function clearCanonicalAbove(height: number): Promise<number> {
  const start = process.hrtime.bigint();
  const result = await getPool().query(
    `UPDATE monero_blocks
        SET is_canonical = false,
            is_settled = false
      WHERE height > $1
        AND (is_canonical OR is_settled)`,
    [height],
  );
  const count = result.rowCount ?? 0;
  observeFlush('derived', Number(process.hrtime.bigint() - start) / 1_000_000_000, {
    monero_blocks: count,
  });
  return count;
}

export async function findCommonAncestor(startHeight: number): Promise<CanonicalPoint | null> {
  let offset = 0;

  for (;;) {
    const { rows } = await getPool().query<StoredCanonicalRow>(
      `SELECT height::text, hash
         FROM monero_blocks
        WHERE is_canonical
          AND height <= $1
        ORDER BY height DESC
        LIMIT $2 OFFSET $3`,
      [startHeight, COMMON_ANCESTOR_PAGE_SIZE, offset],
    );

    if (rows.length === 0) return null;

    for (const row of rows) {
      const height = Number(row.height);
      const header = await fetchBlockHeaderByHeight(height, 10_000, 1).catch(() => null);
      if (header?.hash === row.hash) {
        return { height, hash: row.hash };
      }
    }

    offset += rows.length;
  }
}

async function updateSettlement(tipHeight: number): Promise<{ marked: number; cleared: number }> {
  const settledHeight = Math.max(-1, tipHeight - config.SETTLEMENT_DEPTH);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const marked = await client.query(
      `UPDATE monero_blocks
          SET is_settled = true
        WHERE is_canonical
          AND NOT is_settled
          AND height <= $1`,
      [settledHeight],
    );
    const cleared = await client.query(
      `UPDATE monero_blocks
          SET is_settled = false
        WHERE is_settled
          AND (NOT is_canonical OR height > $1)`,
      [settledHeight],
    );
    await client.query('COMMIT');
    return {
      marked: marked.rowCount ?? 0,
      cleared: cleared.rowCount ?? 0,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function applyCanonicalBatch(headers: MoneroBlockHeader[], tipHeight: number): Promise<void> {
  if (headers.length === 0) return;

  const heights = headers.map((header) => header.height);
  const hashes = headers.map((header) => header.hash);

  const start = process.hrtime.bigint();
  const result = await getPool().query<{
    marked_count: number;
    unmarked_count: number;
  }>(
    `WITH incoming AS (
       SELECT * FROM unnest($1::bigint[], $2::text[]) AS t(height, hash)
     ),
     marked AS (
       UPDATE monero_blocks block
          SET is_canonical = true
         FROM incoming
        WHERE block.height = incoming.height
          AND block.hash = incoming.hash
          AND NOT block.is_canonical
        RETURNING block.hash
     ),
     unmarked AS (
       UPDATE monero_blocks block
          SET is_canonical = false,
              is_settled = false
        WHERE block.height IN (SELECT height FROM incoming)
          AND NOT EXISTS (
            SELECT 1
              FROM incoming
             WHERE incoming.height = block.height
               AND incoming.hash = block.hash
          )
          AND (block.is_canonical OR block.is_settled)
        RETURNING block.hash
     )
     SELECT
       (SELECT COUNT(*)::integer FROM marked) AS marked_count,
       (SELECT COUNT(*)::integer FROM unmarked) AS unmarked_count`,
    [heights, hashes],
  );

  const settlement = await updateSettlement(tipHeight);
  const counts = result.rows[0] ?? { marked_count: 0, unmarked_count: 0 };
  observeFlush('derived', Number(process.hrtime.bigint() - start) / 1_000_000_000, {
    monero_blocks: counts.marked_count + counts.unmarked_count + settlement.marked + settlement.cleared,
  });

  if (counts.marked_count > 0 || counts.unmarked_count > 0 || settlement.marked > 0 || settlement.cleared > 0) {
    logger.info('Canonical Monero range updated', {
      from_height: Math.min(...heights),
      to_height: Math.max(...heights),
      tip_height: tipHeight,
      marked_rows: counts.marked_count,
      unmarked_rows: counts.unmarked_count,
      settled_rows: settlement.marked,
      cleared_settlement_rows: settlement.cleared,
    });
  }
}
