import { config } from './config.js';
import { closePool, getPool } from './db/pg.js';
import { setPhase } from './metrics/registry.js';
import { startMetricsSampler } from './metrics/sampler.js';
import { fetchInfo, fetchPruneStatus } from './rpc/client.js';
import { startSupplyScheduler, runSupplyMaintenance } from './runner/supplyHourly.js';
import { followChain, waitForNode } from './runner/follow.js';
import { syncFromProgress } from './runner/syncRange.js';
import { startApiServer } from './api.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  setPhase('starting');
  logger.info('monero-indexer starting', {
    node: config.NODE_URL,
    follow: config.FOLLOW,
    from_height: config.FROM_HEIGHT,
    settlement_depth: config.SETTLEMENT_DEPTH,
    supply_enabled: config.SUPPLY_ENABLED,
  });

  const pool = getPool();
  await pool.query('SELECT 1');
  logger.info('Database connected');

  const stopApi = startApiServer();
  const stopMetrics = startMetricsSampler();

  await waitForNode();

  const pruneStatus = await fetchPruneStatus(10_000, 1).catch(() => null);
  if (pruneStatus) {
    logger.info('Monero prune status loaded', {
      pruned: pruneStatus.pruned,
      pruning_seed: pruneStatus.pruning_seed,
    });
  }

  const info = await fetchInfo();
  setPhase('backfill');
  logger.info('Starting Monero backfill to current tip', {
    height: info.height,
    target_height: info.target_height,
    synchronized: info.synchronized,
    busy_syncing: info.busy_syncing,
  });
  await syncFromProgress(info.height);

  const stopSupply = startSupplyScheduler();

  if (config.FOLLOW) {
    setPhase('follow');
    const stopFollow = followChain();

    async function shutdown(): Promise<void> {
      setPhase('shutdown');
      logger.info('Shutting down…');
      stopFollow();
      stopSupply();
      stopMetrics();
      stopApi();
      await closePool();
      process.exit(0);
    }

    process.on('SIGINT', () => { void shutdown(); });
    process.on('SIGTERM', () => { void shutdown(); });

    logger.info('Following Monero chain tip — press Ctrl+C to stop');
  } else {
    await runSupplyMaintenance('backfill-only');
    setPhase('shutdown');
    stopSupply();
    stopMetrics();
    stopApi();
    await closePool();
    logger.info('Backfill-only mode complete');
  }
}

main().catch((err) => {
  setPhase('shutdown');
  console.error('Fatal error:', err);
  process.exit(1);
});
