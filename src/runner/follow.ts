import type pg from 'pg';
import { config } from '../config.js';
import { getLastBlock } from '../db/progress.js';
import { setChainTipHeight, setIndexedHeight, setPhase } from '../metrics/registry.js';
import type { MidenRpcClient } from '../rpc/client.js';
import { logger } from '../utils/logger.js';
import { syncRange } from './syncRange.js';

const INITIAL_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 60_000;

export interface FollowOptions {
  batchSize: number;
  pollIntervalMs: number;
  maxLagBlocksBeforeBatch: number;
}

export interface RunnerStopHandle {
  stop: () => Promise<void>;
}

function chainTipFromStatus(status: Awaited<ReturnType<MidenRpcClient['status']>>): number {
  const chainTip = status.store?.chainTip ?? status.blockProducer?.chainTip;
  if (chainTip === undefined) throw new Error('RPC status did not include a chain tip');
  return chainTip;
}

function batchSizeForLag(lag: number, opts: FollowOptions): number {
  if (lag <= opts.maxLagBlocksBeforeBatch) {
    return Math.max(1, Math.min(opts.batchSize, Math.max(1, lag), 5));
  }
  return opts.batchSize;
}

export async function startFollow(
  rpc: MidenRpcClient,
  pool: pg.Pool,
  opts: FollowOptions = {
    batchSize: config.BATCH_SIZE,
    pollIntervalMs: config.POLL_INTERVAL_MS,
    maxLagBlocksBeforeBatch: config.MAX_LAG_BLOCKS_BEFORE_BATCH,
  },
): Promise<RunnerStopHandle> {
  let stopped = false;
  let wakeSleep: (() => void) | null = null;
  let loopDone: Promise<void>;

  function interruptibleSleep(ms: number): Promise<void> {
    if (stopped) return Promise.resolve();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        wakeSleep = null;
        resolve();
      }, ms);
      wakeSleep = () => {
        clearTimeout(timer);
        wakeSleep = null;
        resolve();
      };
    });
  }

  async function runLoop(): Promise<void> {
    let backoffMs = INITIAL_BACKOFF_MS;

    while (!stopped) {
      try {
        const tip = chainTipFromStatus(await rpc.status());
        setChainTipHeight(tip);
        const lastBlock = await getLastBlock(pool);
        setIndexedHeight(lastBlock);
        if (tip > lastBlock) {
          const lag = tip - lastBlock;
          await syncRange(rpc, pool, lastBlock + 1, tip, batchSizeForLag(lag, opts));
        }
        backoffMs = INITIAL_BACKOFF_MS;
        if (!stopped) await interruptibleSleep(opts.pollIntervalMs);
      } catch (err) {
        logger.warn('Follow poll cycle failed; retrying after backoff', { err, backoff_ms: backoffMs });
        if (!stopped) await interruptibleSleep(backoffMs);
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
      }
    }
  }

  setPhase('follow');
  const initialTip = chainTipFromStatus(await rpc.status());
  setChainTipHeight(initialTip);
  const initialLastBlock = await getLastBlock(pool);
  setIndexedHeight(initialLastBlock);
  if (initialTip > initialLastBlock) {
    await syncRange(rpc, pool, initialLastBlock + 1, initialTip, opts.batchSize);
  }

  loopDone = runLoop().catch((err: unknown) => {
    logger.error('Follow loop exited unexpectedly', { err });
  });

  return {
    stop: async () => {
      stopped = true;
      wakeSleep?.();
      await loopDone;
    },
  };
}
