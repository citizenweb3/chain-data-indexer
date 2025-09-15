/**
 * Implements the live follow loop to sync blocks continuously from the latest blockchain height.
 */

// src/runner/follow.ts
import { getLogger } from '../utils/logger.ts';
import { createRpcClientFromConfig } from '../rpc/client.ts';
import { createTxDecodePool } from '../decode/txPool.ts';
import { createSink } from '../sink/index.ts';
import { syncRange, CaseMode } from './syncRange.ts';
import { sleep } from '../utils/sleep.ts';

const log = getLogger('follow');

/**
 * Specifies the configuration options for the follow loop.
 *
 * @property startNext - The height of the next block from which to start following.
 * @property pollMs - Polling interval in milliseconds to check for new blocks.
 * @property concurrency - Maximum number of blocks to process in parallel.
 * @property caseMode - Mode for handling case processing (type `CaseMode`).
 */
export interface FollowOptions {
  startNext: number;
  pollMs: number;
  concurrency: number;
  caseMode: CaseMode;
}

/**
 * Runs an infinite loop to follow the blockchain from a starting height,
 * fetching and processing new blocks as they are produced.
 *
 * @param rpc - RPC client created from configuration.
 * @param decodePool - Transaction decode worker pool.
 * @param sink - Sink implementation where indexed data is persisted.
 * @param opts - Options controlling the follow behavior (type `FollowOptions`).
 * @returns A Promise that resolves to void. This function never terminates under normal conditions.
 */
export async function followLoop(
  rpc: ReturnType<typeof createRpcClientFromConfig>,
  decodePool: ReturnType<typeof createTxDecodePool>,
  sink: ReturnType<typeof createSink>,
  opts: FollowOptions,
): Promise<void> {
  let next = opts.startNext;
  log.info(`[follow] entering live mode from height ${next}, poll=${opts.pollMs}ms`);
  for (;;) {
    const st = await rpc.fetchStatus();
    const latest = Number(st['sync_info']['latest_block_height']);
    if (next <= latest) {
      const to = latest;
      const live = await syncRange(rpc, decodePool, sink, {
        from: next,
        to,
        concurrency: Math.min(opts.concurrency, 16),
        progressEveryBlocks: 25,
        progressIntervalSec: 2,
        caseMode: opts.caseMode,
        reportSpeed: false,
      });
      next = to + 1;
      log.info(`[follow] caught up ${live.processed} blocks → next=${next}, latest=${latest}`);
      await sink.flush?.();
    } else {
      const jitter = 0.8 + Math.random() * 0.4;
      await sleep(Math.floor(opts.pollMs * jitter));
    }
  }
}
