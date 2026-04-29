import { config } from './config.js';
import { startApiServer } from './api.js';
import { getPool, closePool } from './db/pg.js';
import { startFollow } from './runner/follow.js';
import { logger } from './utils/logger.js';

function printHelp(): void {
  console.log(`miden-indexer

Usage:
  npm run dev
  npm run build && npm start

Environment:
  NODE_URL=${config.NODE_URL}
  INDEXER_HTTP_PORT=${config.INDEXER_HTTP_PORT}
  START_BLOCK=${config.START_BLOCK}
`);
}

async function main(): Promise<void> {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }

  logger.info('miden-indexer starting', {
    node_url: config.NODE_URL,
    start_block: config.START_BLOCK,
    batch_size: config.BATCH_SIZE,
  });

  getPool();
  logger.info('PostgreSQL pool initialized');

  const stopRunner = await startFollow();
  const stopApi = startApiServer();

  async function shutdown(signal: string): Promise<void> {
    logger.info('Shutting down', { signal });
    stopRunner();
    stopApi();
    await closePool();
    process.exit(0);
  }

  process.on('SIGINT', () => { shutdown('SIGINT').catch((err) => logger.error('Shutdown failed', { err })); });
  process.on('SIGTERM', () => { shutdown('SIGTERM').catch((err) => logger.error('Shutdown failed', { err })); });
}

main().catch((err: unknown) => {
  logger.error('Fatal error', { err });
  process.exit(1);
});
