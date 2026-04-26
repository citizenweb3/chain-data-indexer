import { config } from './config.js';
import { logger } from './utils/logger.js';
import { getPool, closePool } from './db/pg.js';
import { syncFromProgress } from './runner/syncRange.js';
import { followBlocks, waitForOnline } from './runner/follow.js';
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

  // Wait until node is Online before indexing
  await waitForOnline();

  // Determine current tip slot for backfill upper bound
  const info = await fetchInfo();
  logger.info('Starting backfill to current tip', { slot: info.slot, height: info.height });

  await syncFromProgress(info.slot);

  if (config.FOLLOW) {
    const stopFollow = followBlocks();

    // Graceful shutdown
    process.on('SIGINT', async () => {
      logger.info('Shutting down…');
      stopFollow();
      await closePool();
      process.exit(0);
    });
    process.on('SIGTERM', async () => {
      logger.info('Shutting down…');
      stopFollow();
      await closePool();
      process.exit(0);
    });

    logger.info('Following live blocks — press Ctrl+C to stop');
  } else {
    await closePool();
    logger.info('Backfill-only mode complete');
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
