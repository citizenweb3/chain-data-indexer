import { config } from '../config.js';
import { getMaxCanonicalHeight, getProgress, setProgress } from '../db/progress.js';
import { fetchBlockByHeight, fetchBlockHeaderByHeight, fetchTransactions, parseBlockJson } from '../rpc/client.js';
import { processBatch } from '../sink/postgres.js';
import { logger } from '../utils/logger.js';
import { applyCanonicalBatch, clearCanonicalAbove, findCommonAncestor } from './canonicalChain.js';
import type { IndexedMoneroBlock, MoneroRpcTransaction } from '../types.js';

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    chunks.push(values.slice(i, i + size));
  }
  return chunks;
}

async function fetchIndexedBlocks(heights: number[]): Promise<IndexedMoneroBlock[]> {
  const results: IndexedMoneroBlock[] = new Array(heights.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= heights.length) return;
      const height = heights[index];
      const block = await fetchBlockByHeight(height);
      const parsedBlock = parseBlockJson(block);
      results[index] = {
        block,
        parsedBlock,
        transactions: [],
      };
    }
  }

  const workers = Array.from(
    { length: Math.min(config.RPC_CONCURRENCY, heights.length) },
    () => worker(),
  );
  await Promise.all(workers);

  const txHashes = unique(
    results.flatMap((entry) => entry.parsedBlock.tx_hashes ?? []),
  );
  const txMap = new Map<string, MoneroRpcTransaction>();

  for (const hashes of chunk(txHashes, config.TX_BATCH_SIZE)) {
    const transactions = await fetchTransactions(hashes);
    for (const tx of transactions) {
      txMap.set(tx.tx_hash, tx);
    }
  }

  return results.map((entry) => {
    const transactions = entry.parsedBlock.tx_hashes.map((hash) => {
      const tx = txMap.get(hash);
      if (!tx) {
        throw new Error(`missing transaction payload for hash ${hash} at block ${entry.block.block_header.hash}`);
      }
      return tx;
    });
    return { ...entry, transactions };
  });
}

export async function syncRange(fromHeight: number, toHeight: number): Promise<void> {
  let cursor = fromHeight;

  logger.info('Starting Monero backfill', {
    from_height: fromHeight,
    to_height: toHeight,
    batch_size: config.BATCH_SIZE,
    rpc_concurrency: config.RPC_CONCURRENCY,
  });

  while (cursor <= toHeight) {
    const batchEnd = Math.min(cursor + config.BATCH_SIZE - 1, toHeight);
    const heights = Array.from(
      { length: batchEnd - cursor + 1 },
      (_, index) => cursor + index,
    );

    const entries = await fetchIndexedBlocks(heights);
    const inserted = await processBatch(entries);
    await applyCanonicalBatch(entries.map((entry) => entry.block.block_header), batchEnd);

    const last = entries.at(-1);
    if (last) {
      await setProgress(last.block.block_header.height, last.block.block_header.hash);
    }

    logger.info('Monero backfill batch complete', {
      from_height: cursor,
      to_height: batchEnd,
      blocks_in_batch: entries.length,
      new_blocks: inserted,
      txs_in_batch: entries.reduce((sum, entry) => sum + entry.transactions.length, 0),
      tip_hash: last?.block.block_header.hash ?? null,
    });

    cursor = batchEnd + 1;
  }

  logger.info('Monero backfill complete', { to_height: toHeight });
}

export async function syncFromProgress(toHeight: number): Promise<void> {
  const [progress, maxCanonicalHeight] = await Promise.all([
    getProgress(),
    getMaxCanonicalHeight(),
  ]);

  const progressFromHeight = progress.lastHeight >= config.FROM_HEIGHT
    ? progress.lastHeight + 1
    : config.FROM_HEIGHT;

  let repairFromHeight = maxCanonicalHeight === null
    ? config.FROM_HEIGHT
    : Math.max(config.FROM_HEIGHT, maxCanonicalHeight + 1);

  if (progress.lastHash && progress.lastHeight >= config.FROM_HEIGHT && progress.lastHeight <= toHeight) {
    try {
      const header = await fetchBlockHeaderByHeight(progress.lastHeight, 10_000, 1);
      if (header.hash !== progress.lastHash) {
        const ancestor = await findCommonAncestor(progress.lastHeight);
        const ancestorHeight = ancestor?.height ?? (config.FROM_HEIGHT - 1);
        await clearCanonicalAbove(ancestorHeight);
        repairFromHeight = Math.max(config.FROM_HEIGHT, ancestorHeight + 1);
        logger.warn('Monero reorg detected; canonical tail will be rescanned', {
          stored_height: progress.lastHeight,
          stored_hash: progress.lastHash,
          current_hash: header.hash,
          common_ancestor_height: ancestorHeight,
        });
      }
    } catch (err) {
      logger.warn('Unable to verify Monero canonical tip before sync; keeping stored progress', { err });
    }
  }

  const fromHeight = Math.min(progressFromHeight, repairFromHeight);

  if (fromHeight > toHeight) {
    logger.info('Monero backfill already up to date', { from_height: fromHeight, to_height: toHeight });
    return;
  }

  if (fromHeight < progressFromHeight) {
    logger.warn('Progress is ahead of the canonical chain; rescanning Monero tail range', {
      saved_height: progress.lastHeight,
      max_canonical_height: maxCanonicalHeight,
      from_height: fromHeight,
      to_height: toHeight,
    });
  }

  await syncRange(fromHeight, toHeight);
}
