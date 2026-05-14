import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { MidenRpcClient } from '../src/rpc/client.js';
import { deriveBlockHash, processBatch, processBlock } from '../src/sink/postgres.js';
import type { BlockBundle, BlockHeader } from '../src/types.js';

// Usage: DATABASE_URL=postgres://user:pass@host:port/db npx tsx scripts/smoke-sink.ts
const { Pool } = pg;

const SCHEMA_PATH = new URL('../initdb/001-schema.sql', import.meta.url);
const TABLES = ['miden_blocks', 'miden_transactions', 'miden_notes', 'miden_nullifiers', 'miden_accounts'] as const;

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

async function resetSchema(pool: pg.Pool): Promise<void> {
  const schemaSql = await readFile(SCHEMA_PATH, 'utf8');
  await pool.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await pool.query(schemaSql);
}

function isZeroDigest(value: Buffer): boolean {
  return value.equals(Buffer.alloc(value.length));
}

function fallbackCounts(header: BlockHeader): Pick<BlockBundle, 'txCount' | 'noteCount' | 'nullifierCount'> {
  return {
    txCount: isZeroDigest(header.txCommitment) ? 0 : 1,
    noteCount: 0,
    nullifierCount: 0,
  };
}

async function bundleBlock(client: MidenRpcClient, blockNum: number): Promise<BlockBundle> {
  const [headerResponse, blockResponse] = await Promise.all([
    client.getBlockHeaderByNumber(blockNum),
    client.getBlockByNumber(blockNum),
  ]);
  if (!headerResponse.blockHeader) throw new Error(`missing header for block ${blockNum}`);
  const blockBytes = blockResponse.block ?? Buffer.alloc(0);
  return {
    header: headerResponse.blockHeader,
    blockBytes,
    ...fallbackCounts(headerResponse.blockHeader),
  };
}

async function tableCounts(pool: pg.Pool): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    const { rows } = await pool.query<{ count: string }>(`SELECT COUNT(*) AS count FROM ${table}`);
    counts[table] = Number(rows[0]?.count ?? 0);
  }
  return counts;
}

function countsEqual(left: Record<string, number>, right: Record<string, number>): boolean {
  return TABLES.every((table) => left[table] === right[table]);
}

async function sampleBlock(pool: pg.Pool, blockNum: number): Promise<Record<string, unknown>> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT
       block_num,
       encode(block_hash, 'hex') AS block_hash,
       encode(prev_block_commitment, 'hex') AS prev_block_commitment,
       encode(chain_commitment, 'hex') AS chain_commitment,
       encode(account_root, 'hex') AS account_root,
       encode(nullifier_root, 'hex') AS nullifier_root,
       encode(note_root, 'hex') AS note_root,
       encode(tx_commitment, 'hex') AS tx_commitment,
       encode(validator_key, 'hex') AS validator_key,
       encode(tx_kernel_commitment, 'hex') AS tx_kernel_commitment,
       encode(native_asset_id, 'hex') AS native_asset_id,
       verification_base_fee,
       timestamp,
       tx_count,
       note_count,
       nullifier_count,
       version,
       encode(raw_block_bytes, 'hex') AS raw_block_bytes,
       chain_length,
       inserted_at
     FROM miden_blocks
     WHERE block_num = $1`,
    [blockNum],
  );
  if (!rows[0]) throw new Error(`no miden_blocks row for block ${blockNum}`);
  return rows[0];
}

async function verifyBytea(pool: pg.Pool, bundle: BlockBundle): Promise<{ rawBlockBytesEqual: boolean; blockHashEqual: boolean }> {
  const { rows } = await pool.query<{ raw_block_bytes: Buffer | null; block_hash: Buffer }>(
    'SELECT raw_block_bytes, block_hash FROM miden_blocks WHERE block_num = $1',
    [bundle.header.blockNum],
  );
  if (!rows[0]) throw new Error(`no BYTEA row for block ${bundle.header.blockNum}`);
  const expectedHash = deriveBlockHash(bundle.header, bundle.blockBytes);
  return {
    rawBlockBytesEqual: bundle.blockBytes.length > 0
      ? rows[0].raw_block_bytes?.equals(bundle.blockBytes) === true
      : rows[0].raw_block_bytes === null,
    blockHashEqual: rows[0].block_hash.equals(expectedHash),
  };
}

async function main(): Promise<void> {
  const databaseUrl = targetDatabaseUrl();
  await ensureDatabase(databaseUrl);

  const pool = new Pool({ connectionString: databaseUrl });
  const rpc = new MidenRpcClient({
    url: process.env.NODE_URL ?? 'http://127.0.0.1:57291',
    requestTimeoutMs: Number(process.env.RPC_TIMEOUT_MS ?? 30_000),
  });

  try {
    await resetSchema(pool);
    const status = await rpc.status();
    const latest = status.store?.chainTip ?? status.blockProducer?.chainTip;
    if (latest === undefined) throw new Error('RPC status did not include a chain tip');
    const from = Math.max(0, latest - 9);
    const blockNums = Array.from({ length: latest - from + 1 }, (_unused, index) => from + index);
    const bundles = await Promise.all(blockNums.map((blockNum) => bundleBlock(rpc, blockNum)));

    await processBatch(pool, bundles);
    const countsAfterBatch = await tableCounts(pool);
    await processBlock(pool, bundles[bundles.length - 1]!);
    const countsAfterDuplicate = await tableCounts(pool);

    const { rows: progressRows } = await pool.query<{ last_block: string }>('SELECT last_block FROM miden_indexer_progress WHERE id = 1');
    const bytea = await verifyBytea(pool, bundles[bundles.length - 1]!);
    const sample = await sampleBlock(pool, latest);

    console.log(JSON.stringify({
      database: databaseName(databaseUrl),
      latest,
      indexedBlocks: blockNums,
      countsAfterBatch,
      countsAfterDuplicate,
      idempotentDuplicate: countsEqual(countsAfterBatch, countsAfterDuplicate),
      progressLastBlock: Number(progressRows[0]?.last_block ?? -1),
      byteaRoundTrip: bytea,
      countDerivation: 'GetBlockByNumber exposes only opaque block bytes in v0.13.4; tx_count falls back to tx_commitment non-zero (0/1), note_count/nullifier_count fallback to 0.',
      sampleBlock: sample,
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
