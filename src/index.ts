import { config } from './config.js';
import { logger } from './utils/logger.js';
import { getPool, closePool } from './db/pg.js';
import { syncFromProgress } from './runner/syncRange.js';
import { followBlocks, waitForOnline } from './runner/follow.js';
import { followLib } from './runner/followLib.js';
import { startApiServer } from './api.js';
import { fetchInfo } from './rpc/client.js';
import { setPhase } from './metrics/registry.js';
import { startMetricsSampler } from './metrics/sampler.js';
import { repairAndDeriveHeightsFromAnchor } from './runner/heightRepair.js';

async function main(): Promise<void> {
  setPhase('starting');
  logger.info('logos-indexer starting', {
    node: config.NODE_URL,
    follow: config.FOLLOW,
    from_slot: config.FROM_SLOT,
  });

  // Verify DB connection
  const pool = getPool();
  await pool.query('SELECT 1');
  logger.info('Database connected');

  // Explorer API + health endpoint (always active)
  const stopApi = startApiServer();
  const stopMetrics = startMetricsSampler();

  // Wait until node is Online before indexing
  await waitForOnline();

  // Initial bulk backfill up to current tip
  const info = await fetchInfo();
  setPhase('backfill');
  logger.info('Starting backfill to current tip', { slot: info.slot, height: info.height });
  await syncFromProgress(info.slot);
  await repairAndDeriveHeightsFromAnchor(info.tip, info.height, 'startup-tip');

  if (config.FOLLOW) {
    setPhase('follow');
    // followBlocks fills the gap from backfill end to current tip, then subscribes.
    // followLib marks blocks as finalized via the LIB NDJSON stream.
    const stopBlocks = followBlocks();
    const stopLib    = followLib();

    async function shutdown(): Promise<void> {
      setPhase('shutdown');
      logger.info('Shutting down…');
      stopBlocks();
      stopLib();
      stopMetrics();
      stopApi();
      await closePool();
      process.exit(0);
    }

    process.on('SIGINT',  () => { shutdown().catch(console.error); });
    process.on('SIGTERM', () => { shutdown().catch(console.error); });

    logger.info('Following live blocks — press Ctrl+C to stop');
  } else {
    setPhase('shutdown');
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
