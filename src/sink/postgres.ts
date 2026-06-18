import pg from 'pg';
import { getPool } from '../db/pg.js';
import {
  observeBlock,
  observeFlush,
  setIndexedHeight,
  setSupplyCheckpointHeight,
} from '../metrics/registry.js';
import { parseMoneroJson } from '../rpc/client.js';
import { getTransactionShape } from '../txDecode.js';
import type {
  IndexedMoneroBlock,
  MoneroRpcTransaction,
  MoneroTxJson,
  SupplyCheckpointRow,
} from '../types.js';

type QueryRunner = pg.Pool | pg.PoolClient;

interface InsertedBlockRow {
  hash: string;
  height: string;
}

function atomicString(value: number | string): string {
  return typeof value === 'string' ? value : String(Math.trunc(value));
}

function transactionRaw(tx: MoneroRpcTransaction): Record<string, unknown> {
  return {
    ...tx,
    parsed_json: parseMoneroJson<MoneroTxJson>(tx.as_json),
  };
}

function blockRaw(entry: IndexedMoneroBlock): Record<string, unknown> {
  return {
    ...entry.block,
    parsed_json: entry.parsedBlock,
  };
}

async function insertTransactions(
  entries: IndexedMoneroBlock[],
  qr: QueryRunner,
): Promise<number> {
  const hashes: string[] = [];
  const blockHashes: string[] = [];
  const blockHeights: number[] = [];
  const positions: number[] = [];
  const versions: number[] = [];
  const unlockTimes: string[] = [];
  const coinbaseFlags: boolean[] = [];
  const inputsCounts: number[] = [];
  const outputsCounts: number[] = [];
  const extraSizes: number[] = [];
  const feeAtomics: Array<string | null> = [];
  const sizeBytes: Array<number | null> = [];
  const inPools: boolean[] = [];
  const confirmations: Array<number | null> = [];

  for (const entry of entries) {
    const blockHash = entry.block.block_header.hash;
    const blockHeight = entry.block.block_header.height;

    entry.transactions.forEach((tx, position) => {
      const raw = transactionRaw(tx);
      const shape = getTransactionShape(raw);
      hashes.push(tx.tx_hash);
      blockHashes.push(blockHash);
      blockHeights.push(blockHeight);
      positions.push(position);
      versions.push(shape.version ?? 0);
      unlockTimes.push(shape.unlockTime ?? '0');
      coinbaseFlags.push(shape.isCoinbase);
      inputsCounts.push(shape.inputsCount);
      outputsCounts.push(shape.outputsCount);
      extraSizes.push(shape.extraLength);
      feeAtomics.push(shape.feeAtomic);
      sizeBytes.push(shape.sizeBytes);
      inPools.push(tx.in_pool);
      confirmations.push(tx.confirmations ?? null);
    });
  }

  if (hashes.length === 0) return 0;

  const result = await qr.query(
    `INSERT INTO monero_transactions
       (hash, block_hash, block_height, position, version, unlock_time, is_coinbase, inputs_count, outputs_count,
        extra_size, fee_atomic, size_bytes, in_pool, confirmations)
     SELECT * FROM unnest(
       $1::text[], $2::text[], $3::bigint[], $4::integer[], $5::integer[], $6::text[],
       $7::boolean[], $8::integer[], $9::integer[], $10::integer[], $11::text[], $12::bigint[],
       $13::boolean[], $14::bigint[]
     ) AS t(hash, block_hash, block_height, position, version, unlock_time, is_coinbase, inputs_count, outputs_count,
            extra_size, fee_atomic, size_bytes, in_pool, confirmations)
     ON CONFLICT DO NOTHING`,
    [
      hashes,
      blockHashes,
      blockHeights,
      positions,
      versions,
      unlockTimes,
      coinbaseFlags,
      inputsCounts,
      outputsCounts,
      extraSizes,
      feeAtomics,
      sizeBytes,
      inPools,
      confirmations,
    ],
  );

  return result.rowCount ?? 0;
}

export async function processBlock(entry: IndexedMoneroBlock): Promise<void> {
  await processBatch([entry]);
}

export async function processBatch(entries: IndexedMoneroBlock[]): Promise<number> {
  if (entries.length === 0) return 0;

  const hashes = entries.map((entry) => entry.block.block_header.hash);
  const prevHashes = entries.map((entry) => entry.block.block_header.prev_hash);
  const heights = entries.map((entry) => entry.block.block_header.height);
  const timestamps = entries.map((entry) => entry.block.block_header.timestamp);
  const majorVersions = entries.map((entry) => entry.block.block_header.major_version);
  const minorVersions = entries.map((entry) => entry.block.block_header.minor_version);
  const nonces = entries.map((entry) => entry.block.block_header.nonce);
  const blockSizes = entries.map((entry) => entry.block.block_header.block_size);
  const blockWeights = entries.map((entry) => entry.block.block_header.block_weight);
  const longTermWeights = entries.map((entry) => entry.block.block_header.long_term_weight);
  const numTxes = entries.map((entry) => entry.block.block_header.num_txes);
  const minerTxHashes = entries.map((entry) => entry.block.block_header.miner_tx_hash);
  const rewardAtomics = entries.map((entry) => atomicString(entry.block.block_header.reward));
  const difficultyHexes = entries.map((entry) => entry.block.block_header.wide_difficulty);
  const cumulativeDifficultyHexes = entries.map((entry) => entry.block.block_header.wide_cumulative_difficulty);
  const orphanStatuses = entries.map((entry) => entry.block.block_header.orphan_status);
  const raws = entries.map((entry) => JSON.stringify(blockRaw(entry)));
  const coinbaseExtraHexes = entries.map((entry) => {
    const extra = entry.parsedBlock?.miner_tx?.extra;
    if (Array.isArray(extra) && extra.length > 0) {
      return Buffer.from(extra).toString('hex');
    }
    return null;
  });

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const start = process.hrtime.bigint();

    const { rows: inserted } = await client.query<InsertedBlockRow>(
      `INSERT INTO monero_blocks
         (hash, prev_hash, height, timestamp, major_version, minor_version, nonce,
          block_size, block_weight, long_term_weight, num_txes, miner_tx_hash,
          reward_atomic, difficulty_hex, cumulative_difficulty_hex, orphan_status, raw, coinbase_extra_hex)
       SELECT * FROM unnest(
         $1::text[], $2::text[], $3::bigint[], $4::bigint[], $5::integer[], $6::integer[],
         $7::bigint[], $8::bigint[], $9::bigint[], $10::bigint[], $11::integer[], $12::text[],
         $13::text[], $14::text[], $15::text[], $16::boolean[], $17::jsonb[], $18::text[]
       ) AS t(hash, prev_hash, height, timestamp, major_version, minor_version, nonce,
              block_size, block_weight, long_term_weight, num_txes, miner_tx_hash,
              reward_atomic, difficulty_hex, cumulative_difficulty_hex, orphan_status, raw, coinbase_extra_hex)
       ON CONFLICT (hash) DO NOTHING
       RETURNING hash, height::text`,
      [
        hashes,
        prevHashes,
        heights,
        timestamps,
        majorVersions,
        minorVersions,
        nonces,
        blockSizes,
        blockWeights,
        longTermWeights,
        numTxes,
        minerTxHashes,
        rewardAtomics,
        difficultyHexes,
        cumulativeDifficultyHexes,
        orphanStatuses,
        raws,
        coinbaseExtraHexes,
      ],
    );

    const transactionRows = await insertTransactions(entries, client);

    await client.query('COMMIT');

    const duration = Number(process.hrtime.bigint() - start) / 1_000_000_000;
    observeFlush('core', duration, {
      monero_blocks: inserted.length,
      monero_transactions: transactionRows,
    });
    if (inserted.length > 0) {
      observeBlock(duration, inserted.length);
      setIndexedHeight(Math.max(...inserted.map((row) => Number(row.height))));
    }
    return inserted.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getLatestSupplyCheckpoint(maxHeight?: number): Promise<SupplyCheckpointRow | null> {
  const pool = getPool();
  const values: unknown[] = [];
  const where = maxHeight === undefined ? '' : 'WHERE height <= $1';
  if (maxHeight !== undefined) values.push(maxHeight);

  const { rows } = await pool.query<{
    height: string;
    block_hash: string;
    block_timestamp: string;
    cumulative_emission_atomic: string;
    cumulative_fee_atomic: string;
    source_method: string;
    computed_at: Date;
  }>(
    `SELECT height::text, block_hash, block_timestamp::text, cumulative_emission_atomic,
            cumulative_fee_atomic, source_method, computed_at
       FROM monero_supply_checkpoints
       ${where}
      ORDER BY height DESC
      LIMIT 1`,
    values,
  );

  if (rows.length === 0) return null;
  return {
    height: Number(rows[0].height),
    block_hash: rows[0].block_hash,
    block_timestamp: Number(rows[0].block_timestamp),
    cumulative_emission_atomic: rows[0].cumulative_emission_atomic,
    cumulative_fee_atomic: rows[0].cumulative_fee_atomic,
    source_method: rows[0].source_method,
    computed_at: rows[0].computed_at,
  };
}

export async function deleteSupplyCheckpointsAbove(height: number): Promise<number> {
  const start = process.hrtime.bigint();
  const result = await getPool().query(
    'DELETE FROM monero_supply_checkpoints WHERE height > $1',
    [height],
  );
  observeFlush('supply', Number(process.hrtime.bigint() - start) / 1_000_000_000, {
    monero_supply_checkpoints: result.rowCount ?? 0,
  });
  return result.rowCount ?? 0;
}

export async function upsertSupplyCheckpoint(checkpoint: Omit<SupplyCheckpointRow, 'computed_at'>): Promise<void> {
  const start = process.hrtime.bigint();
  await getPool().query(
    `INSERT INTO monero_supply_checkpoints
       (height, block_hash, block_timestamp, cumulative_emission_atomic, cumulative_fee_atomic, source_method, computed_at)
     VALUES ($1, $2, $3, $4, $5, $6, now())
     ON CONFLICT (height) DO UPDATE
       SET block_hash = EXCLUDED.block_hash,
           block_timestamp = EXCLUDED.block_timestamp,
           cumulative_emission_atomic = EXCLUDED.cumulative_emission_atomic,
           cumulative_fee_atomic = EXCLUDED.cumulative_fee_atomic,
           source_method = EXCLUDED.source_method,
           computed_at = now()`,
    [
      checkpoint.height,
      checkpoint.block_hash,
      checkpoint.block_timestamp,
      checkpoint.cumulative_emission_atomic,
      checkpoint.cumulative_fee_atomic,
      checkpoint.source_method,
    ],
  );
  observeFlush('supply', Number(process.hrtime.bigint() - start) / 1_000_000_000, {
    monero_supply_checkpoints: 1,
  });
  setSupplyCheckpointHeight(checkpoint.height);
}
