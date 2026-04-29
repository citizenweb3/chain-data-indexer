import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import pg from 'pg';
import { startRunner } from '../src/runner/index.js';
import { MidenRpcClient } from '../src/rpc/client.js';
import { getLastBlock } from '../src/db/progress.js';
import type { Config } from '../src/config.js';

const { Pool } = pg;
const SCHEMA_PATH = new URL('../initdb/001-schema.sql', import.meta.url);

function targetDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const user = encodeURIComponent(process.env.PGUSER ?? process.env.PG_USER ?? 'miden');
  const password = encodeURIComponent(process.env.PGPASSWORD ?? process.env.PG_PASSWORD ?? 'CHANGE_ME');
  const host = process.env.PGHOST ?? process.env.PG_HOST ?? 'localhost';
  const port = process.env.PGPORT ?? process.env.PG_PORT ?? process.env.PG_HOST_PORT ?? '5432';
  const database = encodeURIComponent(process.env.SMOKE_DB ?? 'miden_indexer_smoke');
  return `postgres://${user}:${password}@${host}:${port}/${database}`;
}

function adminDatabaseUrl(targetUrl: string): string {
  if (process.env.SMOKE_ADMIN_DATABASE_URL) return process.env.SMOKE_ADMIN_DATABASE_URL;
  const parsed = new URL(targetUrl);
  parsed.pathname = `/${process.env.SMOKE_ADMIN_DB ?? 'postgres'}`;
  return parsed.toString();
}

function databaseName(databaseUrl: string): string {
  const name = new URL(databaseUrl).pathname.slice(1);
  if (!name) throw new Error('DATABASE_URL must include a database name');
  return decodeURIComponent(name);
}

async function ensureDatabase(databaseUrl: string): Promise<void> {
  const dbName = databaseName(databaseUrl);
  const adminPool = new Pool({ connectionString: adminDatabaseUrl(databaseUrl) });
  try {
    const { rows } = await adminPool.query<{ exists: boolean }>('SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1)', [dbName]);
    if (!rows[0]?.exists) {
      await adminPool.query(`CREATE DATABASE ${pg.escapeIdentifier(dbName)}`);
      console.log(`created database ${dbName}`);
    }
  } finally {
    await adminPool.end();
  }
}

async function initSchema(pool: pg.Pool): Promise<void> {
  const schemaSql = await readFile(SCHEMA_PATH, 'utf8');
  await pool.query(schemaSql);
}

async function blockCount(pool: pg.Pool, fromBlock: number, toBlock: number): Promise<number> {
  const { rows } = await pool.query<{ count: string }>(
    'SELECT COUNT(*) AS count FROM miden_blocks WHERE block_num BETWEEN $1 AND $2',
    [fromBlock, toBlock],
  );
  return Number(rows[0]?.count ?? 0);
}

async function assertNoGaps(pool: pg.Pool, fromBlock: number, toBlock: number): Promise<void> {
  const { rows } = await pool.query<{ missing: string }>(
    `WITH expected AS (
       SELECT generate_series($1::bigint, $2::bigint) AS block_num
     )
     SELECT COUNT(*) AS missing
     FROM expected e
     LEFT JOIN miden_blocks b ON b.block_num = e.block_num
     WHERE b.block_num IS NULL`,
    [fromBlock, toBlock],
  );
  const missing = Number(rows[0]?.missing ?? 0);
  if (missing !== 0) throw new Error(`gap check failed: ${missing} missing blocks`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function chainTip(status: Awaited<ReturnType<MidenRpcClient['status']>>): number {
  const tip = status.store?.chainTip ?? status.blockProducer?.chainTip;
  if (tip === undefined) throw new Error('RPC status did not include a chain tip');
  return tip;
}

async function main(): Promise<void> {
  const databaseUrl = targetDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;
  await ensureDatabase(databaseUrl);

  const pool = new Pool({ connectionString: databaseUrl });
  const rpc = new MidenRpcClient({
    url: process.env.NODE_URL ?? 'http://127.0.0.1:57291',
    requestTimeoutMs: Number(process.env.RPC_TIMEOUT_MS ?? 30_000),
  });

  try {
    await initSchema(pool);
    const tip = chainTip(await rpc.status());
    const startBlockEnv = process.env.START_BLOCK;
    const startBlock =
      startBlockEnv === undefined || startBlockEnv === ''
        ? Math.max(0, tip - 100)
        : Number(startBlockEnv);
    const smokeConfig: Config = {
      NODE_URL: process.env.NODE_URL ?? 'http://127.0.0.1:57291',
      DATABASE_URL: databaseUrl,
      PG_HOST: process.env.PG_HOST ?? 'localhost',
      PG_PORT: Number(process.env.PG_PORT ?? 5432),
      PG_DB: databaseName(databaseUrl),
      PG_USER: process.env.PG_USER ?? 'miden',
      PG_PASSWORD: process.env.PG_PASSWORD ?? 'CHANGE_ME',
      INDEXER_HTTP_PORT: Number(process.env.INDEXER_HTTP_PORT ?? 3001),
      START_BLOCK: startBlock,
      BATCH_SIZE: 10,
      POLL_INTERVAL_MS: 1_500,
      BACKFILL_CONCURRENCY: Number(process.env.BACKFILL_CONCURRENCY ?? 1),
      MAX_LAG_BLOCKS_BEFORE_BATCH: 5,
      LOG_LEVEL: 'info',
    };

    const beforeLastBlock = await getLastBlock(pool);
    const startedAt = performance.now();
    const runner = await startRunner(rpc, pool, smokeConfig);

    let followCycles = 0;
    while (followCycles < 2) {
      await sleep(smokeConfig.POLL_INTERVAL_MS);
      followCycles += 1;
      const lastBlock = await getLastBlock(pool);
      if (lastBlock < tip) continue;
    }

    const lastBlock = await getLastBlock(pool);
    if (lastBlock < tip) throw new Error(`runner did not reach tip ${tip}; last_block=${lastBlock}`);

    await runner.stop();
    const elapsedSeconds = (performance.now() - startedAt) / 1_000;
    const expectedBlocks = tip - startBlock + 1;
    const rowsInRange = await blockCount(pool, startBlock, tip);
    if (rowsInRange !== expectedBlocks) {
      throw new Error(`block count mismatch: expected ${expectedBlocks}, got ${rowsInRange}`);
    }
    await assertNoGaps(pool, startBlock, tip);

    console.log(JSON.stringify({
      database: databaseName(databaseUrl),
      startBlock,
      tip,
      beforeLastBlock,
      lastBlock,
      rowsInRange,
      expectedBlocks,
      elapsedSeconds: Number(elapsedSeconds.toFixed(3)),
      averageBackfillBlocksPerSecond: Number((expectedBlocks / elapsedSeconds).toFixed(3)),
      followCycles,
    }, null, 2));
  } finally {
    rpc.close();
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
