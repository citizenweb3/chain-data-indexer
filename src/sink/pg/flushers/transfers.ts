// src/sink/pg/flushers/transfers.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';

/**
 * Flushes batched transfer rows into the `bank.transfers` table in Postgres.
 *
 * @param {PoolClient} client - The Postgres PoolClient used to execute queries.
 * @param {any[]} rows - An array of transfer records to insert.
 * @returns {Promise<void>} A Promise that resolves when the insert is complete.
 */
export async function flushTransfers(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows.length) return;
  await client.query(`SET LOCAL statement_timeout = '30s'`);
  await client.query(`SET LOCAL lock_timeout = '5s'`);
  const cols = ['tx_hash', 'msg_index', 'from_addr', 'to_addr', 'denom', 'amount', 'height'];
  await execBatchedInsert(
    client,
    'bank.transfers',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash, msg_index, from_addr, to_addr, denom) DO NOTHING',
    undefined,
    { maxRows: 5000, maxParams: 30000 },
  );
}
