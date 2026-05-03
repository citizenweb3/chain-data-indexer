import { getPool } from '../db/pg.js';
import { setLastHeight } from '../db/progress.js';
import { fetchBlockByHash } from '../rpc/client.js';
import { processBlock } from '../sink/postgres.js';
import { observeFlush, setIndexedHeight } from '../metrics/registry.js';
import { logger } from '../utils/logger.js';
import type { LogosBlock } from '../types.js';

interface MissingParentRow {
  missing_id: string;
  missing_height: string;
  child_id: string;
}

interface HeightDerivationRow {
  chain_count: number;
  updated_count: number;
  min_height: string | null;
  max_height: string | null;
}

interface RepairResult {
  fetchedParents: number;
  derivedRows: number;
  chainRows: number;
}

const MAX_PARENT_REPAIR_FETCHES = 10_000;

function isValidAnchor(anchorId: string, anchorHeight: number): boolean {
  return anchorId.length > 0 && Number.isSafeInteger(anchorHeight) && anchorHeight >= 0;
}

function isBlockLike(value: unknown): value is LogosBlock {
  return !!value
    && typeof value === 'object'
    && 'header' in value
    && !!(value as { header?: unknown }).header
    && typeof (value as { header: { parent_block?: unknown; slot?: unknown } }).header.parent_block === 'string'
    && typeof (value as { header: { parent_block: string; slot?: unknown } }).header.slot === 'number';
}

function enrichFetchedBlock(block: unknown, id: string, height: number): LogosBlock | null {
  if (!isBlockLike(block)) return null;
  return {
    ...block,
    header: {
      ...block.header,
      id,
      height,
    },
  };
}

async function ensureAnchorPresent(anchorId: string, anchorHeight: number): Promise<boolean> {
  const { rows } = await getPool().query<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM logos_blocks WHERE id = $1) AS exists',
    [anchorId],
  );
  if (rows[0]?.exists) return true;

  const block = await fetchBlockByHash(anchorId);
  if (!isBlockLike(block)) {
    logger.warn('Anchor block is unavailable from storage RPC', {
      anchor_id: anchorId,
      anchor_height: anchorHeight,
    });
    return false;
  }
  const enriched = enrichFetchedBlock(block, anchorId, anchorHeight);
  if (!enriched) return false;
  await processBlock(enriched);
  return true;
}

async function findNearestMissingParent(
  anchorId: string,
  anchorHeight: number,
): Promise<MissingParentRow | null> {
  const { rows } = await getPool().query<MissingParentRow>(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_block, $2::bigint AS derived_height
       FROM logos_blocks
       WHERE id = $1
       UNION ALL
       SELECT parent.id, parent.parent_block, chain.derived_height - 1
       FROM logos_blocks parent
       JOIN chain ON parent.id = chain.parent_block
       WHERE chain.derived_height > 0
     )
     SELECT
       chain.parent_block AS missing_id,
       (chain.derived_height - 1)::text AS missing_height,
       chain.id AS child_id
     FROM chain
     LEFT JOIN logos_blocks parent ON parent.id = chain.parent_block
     WHERE chain.derived_height > 0
       AND chain.parent_block IS NOT NULL
       AND parent.id IS NULL
     ORDER BY chain.derived_height DESC
     LIMIT 1`,
    [anchorId, anchorHeight],
  );

  return rows[0] ?? null;
}

async function repairMissingParents(anchorId: string, anchorHeight: number): Promise<number> {
  const anchorPresent = await ensureAnchorPresent(anchorId, anchorHeight);
  if (!anchorPresent) return 0;

  let fetched = 0;
  while (fetched < MAX_PARENT_REPAIR_FETCHES) {
    const missing = await findNearestMissingParent(anchorId, anchorHeight);
    if (!missing) return fetched;

    const missingHeight = Number(missing.missing_height);
    if (!Number.isSafeInteger(missingHeight) || missingHeight < 0) {
      logger.warn('Cannot repair missing parent with invalid derived height', {
        child_id: missing.child_id,
        missing_id: missing.missing_id,
        missing_height: missing.missing_height,
      });
      return fetched;
    }

    const block = await fetchBlockByHash(missing.missing_id);
    if (!isBlockLike(block)) {
      logger.warn('Missing parent block is unavailable from storage RPC', {
        child_id: missing.child_id,
        missing_id: missing.missing_id,
        missing_height: missingHeight,
      });
      return fetched;
    }
    const enriched = enrichFetchedBlock(block, missing.missing_id, missingHeight);
    if (!enriched) {
      logger.warn('Missing parent block could not be normalized for storage', {
        child_id: missing.child_id,
        missing_id: missing.missing_id,
        missing_height: missingHeight,
      });
      return fetched;
    }
    await processBlock(enriched);
    fetched++;

    logger.info('Fetched missing parent block for height repair', {
      child_id: missing.child_id.slice(0, 12) + '…',
      parent_id: missing.missing_id.slice(0, 12) + '…',
      height: missingHeight,
      slot: block.header.slot,
    });
  }

  logger.warn('Stopped parent repair after fetch limit', {
    anchor_id: anchorId.slice(0, 12) + '…',
    anchor_height: anchorHeight,
    fetched,
    limit: MAX_PARENT_REPAIR_FETCHES,
  });
  return fetched;
}

async function deriveExistingHeights(anchorId: string, anchorHeight: number): Promise<HeightDerivationRow> {
  const start = process.hrtime.bigint();
  const { rows } = await getPool().query<HeightDerivationRow>(
    `WITH RECURSIVE chain AS (
       SELECT id, parent_block, $2::bigint AS derived_height
       FROM logos_blocks
       WHERE id = $1
       UNION ALL
       SELECT parent.id, parent.parent_block, chain.derived_height - 1
       FROM logos_blocks parent
       JOIN chain ON parent.id = chain.parent_block
       WHERE chain.derived_height > 0
     ),
     updated AS (
       UPDATE logos_blocks block
       SET height = chain.derived_height
       FROM chain
       WHERE block.id = chain.id
         AND block.height IS DISTINCT FROM chain.derived_height
       RETURNING block.id
     )
     SELECT
       (SELECT COUNT(*)::integer FROM chain) AS chain_count,
       (SELECT COUNT(*)::integer FROM updated) AS updated_count,
       (SELECT MIN(derived_height)::text FROM chain) AS min_height,
       (SELECT MAX(derived_height)::text FROM chain) AS max_height`,
    [anchorId, anchorHeight],
  );
  const result = rows[0] ?? {
    chain_count: 0,
    updated_count: 0,
    min_height: null,
    max_height: null,
  };

  observeFlush('derived', Number(process.hrtime.bigint() - start) / 1_000_000_000, {
    logos_blocks: result.updated_count,
  });
  return result;
}

export async function deriveHeightFromParent(blockId: string): Promise<number | null> {
  const start = process.hrtime.bigint();
  const { rows } = await getPool().query<{ height: string | null }>(
    `WITH derived AS (
       SELECT child.id, parent.height + 1 AS derived_height
       FROM logos_blocks child
       JOIN logos_blocks parent ON parent.id = child.parent_block
       WHERE child.id = $1
         AND child.height IS NULL
         AND parent.height IS NOT NULL
     )
     UPDATE logos_blocks block
     SET height = derived.derived_height
     FROM derived
     WHERE block.id = derived.id
     RETURNING block.height::text`,
    [blockId],
  );

  observeFlush('derived', Number(process.hrtime.bigint() - start) / 1_000_000_000, {
    logos_blocks: rows.length,
  });

  if (rows.length === 0 || rows[0].height === null) return null;
  const height = Number(rows[0].height);
  if (!Number.isSafeInteger(height) || height < 0) return null;
  setIndexedHeight(height);
  await setLastHeight(height);
  return height;
}

export async function getStoredBlockHeight(blockId: string): Promise<number | null> {
  const { rows } = await getPool().query<{ height: string | null }>(
    'SELECT height::text FROM logos_blocks WHERE id = $1',
    [blockId],
  );
  if (rows.length === 0 || rows[0].height === null) return null;
  const height = Number(rows[0].height);
  return Number.isSafeInteger(height) && height >= 0 ? height : null;
}

export async function repairAndDeriveHeightsFromAnchor(
  anchorId: string,
  anchorHeight: number,
  source: string,
): Promise<RepairResult> {
  if (!isValidAnchor(anchorId, anchorHeight)) {
    logger.warn('Skipping height derivation from invalid anchor', { source, anchorId, anchorHeight });
    return { fetchedParents: 0, derivedRows: 0, chainRows: 0 };
  }

  const fetchedParents = await repairMissingParents(anchorId, anchorHeight);
  const derived = await deriveExistingHeights(anchorId, anchorHeight);

  if (derived.max_height !== null) {
    const maxHeight = Number(derived.max_height);
    setIndexedHeight(maxHeight);
    await setLastHeight(maxHeight);
  }

  if (fetchedParents > 0 || derived.updated_count > 0) {
    logger.info('Block heights repaired from canonical anchor', {
      source,
      anchor_id: anchorId.slice(0, 12) + '…',
      anchor_height: anchorHeight,
      fetched_parents: fetchedParents,
      chain_rows: derived.chain_count,
      updated_rows: derived.updated_count,
      min_height: derived.min_height,
      max_height: derived.max_height,
    });
  }

  return {
    fetchedParents,
    derivedRows: derived.updated_count,
    chainRows: derived.chain_count,
  };
}
