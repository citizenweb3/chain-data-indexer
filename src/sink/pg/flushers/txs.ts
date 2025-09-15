// src/sink/pg/flushers/txs.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';

/**
 * Inserts or updates transaction records in the core.transactions table in batches.
 *
 * This function uses a batched insert to efficiently persist transaction data.
 * If a transaction with the same height and tx_hash already exists, it updates
 * the gas_used and log_summary fields.
 *
 * @param client - A PostgreSQL PoolClient instance to execute queries.
 * @param rows - An array of transaction objects to be inserted or updated.
 * @returns A Promise that resolves when the operation is complete.
 */
export async function flushTxs(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows.length) return;
  await client.query(`SET LOCAL statement_timeout = '30s'`);
  await client.query(`SET LOCAL lock_timeout = '5s'`);
  const cols = [
    'tx_hash',
    'height',
    'tx_index',
    'code',
    'gas_wanted',
    'gas_used',
    'fee',
    'memo',
    'signers',
    'raw_tx',
    'log_summary',
    'time',
  ];
  await execBatchedInsert(
    client,
    'core.transactions',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash) DO UPDATE SET gas_used = EXCLUDED.gas_used, log_summary = EXCLUDED.log_summary',
    { fee: 'jsonb', raw_tx: 'jsonb' },
    { maxRows: 1000, maxParams: 20000 },
  );
}
