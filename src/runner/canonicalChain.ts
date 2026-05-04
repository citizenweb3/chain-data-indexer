import { getPool } from '../db/pg.js';
import { fetchBlockByHash } from '../rpc/client.js';
import { processBlock } from '../sink/postgres.js';
import { observeFlush } from '../metrics/registry.js';
import { logger } from '../utils/logger.js';
import type { LogosBlock } from '../types.js';

interface MissingParentRow {
  missing_id: string;
  child_id: string;
}

interface CanonicalUpdateRow {
  chain_count: number;
  marked_count: number;
  unmarked_count: number;
  cleared_finality_count: number;
}

interface CanonicalUpdateResult {
  fetchedParents: number;
  chainRows: number;
  markedRows: number;
  unmarkedRows: number;
  clearedFinalityRows: number;
}

const MAX_PARENT_REPAIR_FETCHES = 10_000;

function isBlockLike(value: unknown): value is LogosBlock {
  return !!value
    && typeof value === 'object'
    && 'header' in value
    && !!(value as { header?: unknown }).header
    && typeof (value as { header: { parent_block?: unknown; slot?: unknown } }).header.parent_block === 'string'
    && typeof (value as { header: { parent_block: string; slot?: unknown } }).header.slot === 'number';
}

function enrichFetchedBlock(block: unknown, id: string): LogosBlock | null {
  if (!isBlockLike(block)) return null;
  return {
    ...block,
    header: {
      ...block.header,
      id,
    },
  };
}

async function ensureAnchorPresent(anchorId: string): Promise<boolean> {
  const { rows } = await getPool().query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM logos_blocks WHERE id = $1) AS exists',
    [anchorId],
  );
  if (rows[0]?.exists) return true;

  const block = await fetchBlockByHash(anchorId);
  const enriched = enrichFetchedBlock(block, anchorId);
  if (!enriched) {
    logger.warn('Canonical anchor block is unavailable from storage RPC', { anchor_id: anchorId });
    return false;
  }

  await processBlock(enriched);
  return true;
}

async function findNearestMissingParent(anchorId: string): Promise<MissingParentRow | null> {
  const { rows } = await getPool().query<MissingParentRow>(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_block
       FROM logos_blocks
       WHERE id = $1
       UNION ALL
       SELECT parent.id, parent.parent_block
       FROM logos_blocks parent
       JOIN chain ON parent.id = chain.parent_block
     )
     SELECT
       chain.parent_block AS missing_id,
       chain.id AS child_id
     FROM chain
     LEFT JOIN logos_blocks parent ON parent.id = chain.parent_block
     WHERE chain.parent_block IS NOT NULL
       AND parent.id IS NULL
     LIMIT 1`,
    [anchorId],
  );
  return rows[0] ?? null;
}

async function repairMissingParents(anchorId: string): Promise<number> {
  const anchorPresent = await ensureAnchorPresent(anchorId);
  if (!anchorPresent) return 0;

  let fetched = 0;
  while (fetched < MAX_PARENT_REPAIR_FETCHES) {
    const missing = await findNearestMissingParent(anchorId);
    if (!missing) return fetched;

    const block = await fetchBlockByHash(missing.missing_id);
    const enriched = enrichFetchedBlock(block, missing.missing_id);
    if (!enriched) {
      logger.warn('Missing canonical parent block is unavailable from storage RPC', {
        child_id: missing.child_id,
        missing_id: missing.missing_id,
      });
      return fetched;
    }

    await processBlock(enriched);
    fetched++;
    logger.info('Fetched missing parent block for canonical-chain repair', {
      child_id: missing.child_id.slice(0, 12) + '…',
      parent_id: missing.missing_id.slice(0, 12) + '…',
      slot: block.header.slot,
    });
  }

  logger.warn('Stopped canonical parent repair after fetch limit', {
    anchor_id: anchorId.slice(0, 12) + '…',
    fetched,
    limit: MAX_PARENT_REPAIR_FETCHES,
  });
  return fetched;
}

async function updateCanonicalChain(anchorId: string): Promise<CanonicalUpdateRow> {
  const start = process.hrtime.bigint();
  const { rows } = await getPool().query<CanonicalUpdateRow>(
    `WITH RECURSIVE canonical_chain AS (
       SELECT id, parent_block
       FROM logos_blocks
       WHERE id = $1
       UNION ALL
       SELECT parent.id, parent.parent_block
       FROM logos_blocks parent
       JOIN canonical_chain child ON parent.id = child.parent_block
     ),
     marked AS (
       UPDATE logos_blocks b
       SET is_canonical = true
       FROM canonical_chain c
       WHERE b.id = c.id
         AND NOT b.is_canonical
       RETURNING b.id
     ),
     unmarked AS (
       UPDATE logos_blocks b
       SET is_canonical = false
       WHERE b.is_canonical
         AND NOT EXISTS (SELECT 1 FROM canonical_chain c WHERE c.id = b.id)
       RETURNING b.id
     ),
     cleared_finality AS (
       UPDATE logos_blocks b
       SET finalized = false
       WHERE b.finalized
         AND NOT EXISTS (SELECT 1 FROM canonical_chain c WHERE c.id = b.id)
       RETURNING b.id
     )
     SELECT
       (SELECT COUNT(*)::integer FROM canonical_chain) AS chain_count,
       (SELECT COUNT(*)::integer FROM marked) AS marked_count,
       (SELECT COUNT(*)::integer FROM unmarked) AS unmarked_count,
       (SELECT COUNT(*)::integer FROM cleared_finality) AS cleared_finality_count`,
    [anchorId],
  );
  const result = rows[0] ?? {
    chain_count: 0,
    marked_count: 0,
    unmarked_count: 0,
    cleared_finality_count: 0,
  };

  observeFlush('derived', Number(process.hrtime.bigint() - start) / 1_000_000_000, {
    logos_blocks: result.marked_count + result.unmarked_count + result.cleared_finality_count,
  });
  return result;
}

export async function markCanonicalChain(anchorId: string, source: string): Promise<CanonicalUpdateResult> {
  if (!anchorId) {
    logger.warn('Skipping canonical-chain update for empty anchor', { source });
    return {
      fetchedParents: 0,
      chainRows: 0,
      markedRows: 0,
      unmarkedRows: 0,
      clearedFinalityRows: 0,
    };
  }

  const fetchedParents = await repairMissingParents(anchorId);
  const updated = await updateCanonicalChain(anchorId);

  if (fetchedParents > 0
    || updated.marked_count > 0
    || updated.unmarked_count > 0
    || updated.cleared_finality_count > 0) {
    logger.info('Canonical chain updated', {
      source,
      anchor_id: anchorId.slice(0, 12) + '…',
      fetched_parents: fetchedParents,
      chain_rows: updated.chain_count,
      marked_rows: updated.marked_count,
      unmarked_rows: updated.unmarked_count,
      cleared_finality_rows: updated.cleared_finality_count,
    });
  }

  return {
    fetchedParents,
    chainRows: updated.chain_count,
    markedRows: updated.marked_count,
    unmarkedRows: updated.unmarked_count,
    clearedFinalityRows: updated.cleared_finality_count,
  };
}
