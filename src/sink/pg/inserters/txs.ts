// src/sink/pg/inserters/txs.ts
import type { PoolClient } from 'pg';
import { makeMultiInsert } from '../batch.ts';

/**
 * Inserts multiple transaction records into the `core.transactions` table in a single transaction (block-atomic mode).
 *
 * @param {PoolClient} client - The PostgreSQL PoolClient used to execute the insert.
 * @param {any[]} rows - An array of transaction row objects to be inserted.
 * @returns {Promise<void>} A Promise that resolves when the insert operation completes.
 *
 * @note If `rows` is empty or undefined, the function returns immediately without performing any database operations.
 */
export async function insertTxs(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows?.length) return;
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
  const { text, values } = makeMultiInsert(
    'core.transactions',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash) DO UPDATE SET gas_used = EXCLUDED.gas_used, log_summary = EXCLUDED.log_summary',
  );
  await client.query(text, values);
}
