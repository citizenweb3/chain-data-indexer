import { config } from './config.js';
import { logger } from './utils/logger.js';
import { getPool, closePool } from './db/pg.js';
import { syncFromProgress } from './runner/syncRange.js';
import { followBlocks, waitForOnline } from './runner/follow.js';
import { followLib } from './runner/followLib.js';
import { startApiServer } from './api.js';
import { fetchInfo } from './rpc/client.js';

async function main(): Promise<void> {
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

  // Wait until node is Online before indexing
  await waitForOnline();

  // Initial bulk backfill up to current tip
  const info = await fetchInfo();
  logger.info('Starting backfill to current tip', { slot: info.slot, height: info.height });
  await syncFromProgress(info.slot);

  if (config.FOLLOW) {
    // followBlocks fills the gap from backfill end to current tip, then subscribes.
    // followLib marks blocks as finalized via the LIB NDJSON stream.
    const stopBlocks = followBlocks();
    const stopLib    = followLib();

    async function shutdown(): Promise<void> {
      logger.info('Shutting down…');
      stopBlocks();
      stopLib();
      stopApi();
      await closePool();
      process.exit(0);
    }

    process.on('SIGINT',  () => { shutdown().catch(console.error); });
    process.on('SIGTERM', () => { shutdown().catch(console.error); });

    logger.info('Following live blocks — press Ctrl+C to stop');
  } else {
    stopApi();
    await closePool();
    logger.info('Backfill-only mode complete');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
