import type pg from 'pg';
import type { Config } from '../config.js';
import { getLastBlock } from '../db/progress.js';
import { setChainTipHeight, setIndexedHeight, setPhase } from '../metrics/registry.js';
import type { MidenRpcClient } from '../rpc/client.js';
import { logger } from '../utils/logger.js';
import { startFollow, type RunnerStopHandle } from './follow.js';
import { syncRange } from './syncRange.js';

function chainTipFromStatus(status: Awaited<ReturnType<MidenRpcClient['status']>>): number {
  const chainTip = status.store?.chainTip ?? status.blockProducer?.chainTip;
  if (chainTip === undefined) throw new Error('RPC status did not include a chain tip');
  return chainTip;
}

export async function startRunner(
  rpc: MidenRpcClient,
  pool: pg.Pool,
  config: Config,
): Promise<RunnerStopHandle> {
  const tip = chainTipFromStatus(await rpc.status());
  setChainTipHeight(tip);
  const savedLastBlock = await getLastBlock(pool);
  setIndexedHeight(savedLastBlock);
  const fromBlock = config.START_BLOCK ?? savedLastBlock + 1;

  logger.info('Starting runner', {
    from_block: fromBlock,
    saved_last_block: savedLastBlock,
    chain_tip: tip,
    batch_size: config.BATCH_SIZE,
  });

  if (fromBlock <= tip) {
    setPhase('backfill');
    await syncRange(rpc, pool, fromBlock, tip, config.BATCH_SIZE);
  }

  return startFollow(rpc, pool, {
    batchSize: config.BATCH_SIZE,
    pollIntervalMs: config.POLL_INTERVAL_MS,
    maxLagBlocksBeforeBatch: config.MAX_LAG_BLOCKS_BEFORE_BATCH,
  });
}
