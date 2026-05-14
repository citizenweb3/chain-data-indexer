import type pg from 'pg';
import { config } from '../config.js';
import { getLastBlock, setLastBlock } from '../db/progress.js';
import { observeBlock, setIndexedHeight } from '../metrics/registry.js';
import type { MidenRpcClient } from '../rpc/client.js';
import { processBatch } from '../sink/postgres.js';
import type { BlockBundle, BlockHeader } from '../types.js';
import { logger } from '../utils/logger.js';
import { withRetry } from '../utils/retry.js';

const INITIAL_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isZeroDigest(value: Buffer): boolean {
  return value.equals(Buffer.alloc(value.length));
}

function fallbackCounts(header: BlockHeader): Pick<BlockBundle, 'txCount' | 'noteCount' | 'nullifierCount'> {
  return {
    txCount: isZeroDigest(header.txCommitment) ? 0 : 1,
    noteCount: 0,
    nullifierCount: 0,
  };
}

async function buildBlockBundle(rpc: MidenRpcClient, blockNum: number): Promise<BlockBundle> {
  const [headerResponse, blockResponse] = await Promise.all([
    rpc.getBlockHeaderByNumber(blockNum),
    rpc.getBlockByNumber(blockNum),
  ]);
  if (!headerResponse.blockHeader) throw new Error(`missing header for block ${blockNum}`);
  const blockBytes = blockResponse.block ?? Buffer.alloc(0);
  if (blockBytes.length === 0) {
    logger.warn('Raw block bytes unavailable; using header-derived block hash fallback', {
      block_num: blockNum,
      raw_block_present: blockResponse.block !== undefined,
    });
  }
  return {
    header: headerResponse.blockHeader,
    blockBytes,
    ...fallbackCounts(headerResponse.blockHeader),
  };
}

async function mapWithConcurrency<T, R>(
  values: T[],
  concurrency: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workerCount = Math.min(concurrency, values.length);

  await Promise.all(Array.from({ length: workerCount }, async () => {
    for (;;) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) return;
      results[index] = await worker(values[index]!);
    }
  }));

  return results;
}

function range(fromBlock: number, toBlock: number): number[] {
  return Array.from({ length: toBlock - fromBlock + 1 }, (_unused, index) => fromBlock + index);
}

export async function syncRange(
  rpc: MidenRpcClient,
  pool: pg.Pool,
  fromBlock: number,
  toBlock: number,
  batchSize: number,
): Promise<void> {
  if (batchSize < 1) throw new Error(`batchSize must be >= 1, got ${batchSize}`);
  if (fromBlock > toBlock) return;

  let cursor = fromBlock;
  logger.info('Starting range sync', {
    from_block: fromBlock,
    to_block: toBlock,
    batch_size: batchSize,
    concurrency: config.BACKFILL_CONCURRENCY,
  });

  let backoffMs = INITIAL_BACKOFF_MS;
  while (cursor <= toBlock) {
    try {
      const lastBlock = await getLastBlock(pool);
      if (lastBlock >= cursor) {
        cursor = lastBlock + 1;
        continue;
      }

      const batchFrom = cursor;
      const batchTo = Math.min(batchFrom + batchSize - 1, toBlock);
      const blockNums = range(batchFrom, batchTo);

      const bundles = await withRetry(
        () => mapWithConcurrency(
          blockNums,
          config.BACKFILL_CONCURRENCY,
          (blockNum) => buildBlockBundle(rpc, blockNum),
        ),
        5,
        INITIAL_BACKOFF_MS,
      );

      const sinkStart = process.hrtime.bigint();
      await processBatch(pool, bundles);
      await setLastBlock(batchTo, pool);

      const sinkDurationSec = Number(process.hrtime.bigint() - sinkStart) / 1e9;
      const perBlockSec = bundles.length > 0 ? sinkDurationSec / bundles.length : 0;
      for (let i = 0; i < bundles.length; i += 1) {
        observeBlock(perBlockSec, 1);
      }
      setIndexedHeight(batchTo);

      logger.info('Range sync batch committed', {
        from_block: batchFrom,
        to_block: batchTo,
        blocks: bundles.length,
      });
      cursor = batchTo + 1;
      backoffMs = INITIAL_BACKOFF_MS;
    } catch (err) {
      logger.warn('Range sync batch failed; retrying same cursor after backoff', {
        err,
        cursor,
        to_block: toBlock,
        backoff_ms: backoffMs,
      });
      await sleep(backoffMs);
      backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
    }
  }

  logger.info('Range sync complete', { from_block: fromBlock, to_block: toBlock });
}
