import { fetchBlocks } from '../rpc/client.js';
import { processBatch } from '../sink/postgres.js';
import { getLastSlot, setLastSlot } from '../db/progress.js';
import { withRetry } from '../utils/retry.js';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';

/**
 * Backfill blocks from `fromSlot` up to `toSlot` (inclusive) in batches.
 * Saves progress after each batch for resume support.
 * Fetches each batch with retry + exponential backoff.
 */
export async function syncRange(fromSlot: number, toSlot: number): Promise<void> {
  const batchSize = config.BATCH_SIZE;
  let cursor = fromSlot;
  let lastHeight: number | null = null;

  logger.info('Starting backfill', { fromSlot, toSlot, batchSize });

  while (cursor <= toSlot) {
    const batchEnd = Math.min(cursor + batchSize - 1, toSlot);

    const blocks = await withRetry(() => fetchBlocks(cursor, batchEnd));
    const inserted = await processBatch(blocks);

    for (const block of blocks) {
      if (block.header.height != null) lastHeight = block.header.height;
    }

    logger.info('Backfill batch complete', {
      slot_from: cursor,
      slot_to: batchEnd,
      blocks_in_batch: blocks.length,
      new_blocks: inserted,
      height: lastHeight,
    });

    await setLastSlot(batchEnd, lastHeight);
    cursor = batchEnd + 1;
  }

  logger.info('Backfill complete', { toSlot, lastHeight });
}

/**
 * Resume backfill from the last saved slot up to `toSlot`.
 * If no progress exists, starts from config.FROM_SLOT.
 */
export async function syncFromProgress(toSlot: number): Promise<void> {
  const savedSlot = await getLastSlot();
  const fromSlot = savedSlot > 0 ? savedSlot + 1 : config.FROM_SLOT;
  if (fromSlot > toSlot) {
    logger.info('Backfill already up to date', { fromSlot, toSlot });
    return;
  }
  await syncRange(fromSlot, toSlot);
}
