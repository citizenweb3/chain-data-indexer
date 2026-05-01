import { config } from './config.js';
import { startApiServer } from './api.js';
import { getPool, closePool } from './db/pg.js';
import { setPhase } from './metrics/registry.js';
import { startMetricsSampler } from './metrics/sampler.js';
import { createMidenRpcClient } from './rpc/client.js';
import { startRunner } from './runner/index.js';
import { logger } from './utils/logger.js';

function printHelp(): void {
  console.log(`miden-indexer

Usage:
  npm run dev
  npm run build && npm start

Environment:
  NODE_URL=${config.NODE_URL}
  INDEXER_HTTP_PORT=${config.INDEXER_HTTP_PORT}
  START_BLOCK=${config.START_BLOCK ?? '(saved progress + 1)'}
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
    poll_interval_ms: config.POLL_INTERVAL_MS,
    log_format: config.LOG_FORMAT,
    metrics_enabled: config.METRICS_ENABLED,
  });
  setPhase('starting');

  const pool = getPool();
  logger.info('PostgreSQL pool initialized');

  const rpc = createMidenRpcClient({ url: config.NODE_URL, requestTimeoutMs: 30_000 });
  logger.info('Miden RPC client initialized', { node_url: config.NODE_URL });

  const stopApi = startApiServer();
  const stopSampler = startMetricsSampler(rpc, pool);
  const runner = await startRunner(rpc, pool, config);
  let shuttingDown = false;

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    setPhase('shutdown');
    logger.info('Shutting down', { signal });
    logger.info('Stopping runner');
    await runner.stop();
    logger.info('Stopping metrics sampler');
    stopSampler();
    logger.info('Stopping HTTP API');
    stopApi();
    logger.info('Closing PostgreSQL pool');
    await closePool();
    logger.info('Closing Miden RPC client');
    rpc.close();
    process.exit(0);
  }

  process.on('SIGINT', () => { shutdown('SIGINT').catch((err) => logger.error('Shutdown failed', { err })); });
  process.on('SIGTERM', () => { shutdown('SIGTERM').catch((err) => logger.error('Shutdown failed', { err })); });
}

main().catch((err: unknown) => {
  logger.error('Fatal error', { err });
  process.exit(1);
});
