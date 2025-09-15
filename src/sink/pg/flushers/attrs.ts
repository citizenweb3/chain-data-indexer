// src/sink/pg/flushers/attrs.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';

/**
 * Flushes event attribute rows to the `core.event_attrs` table using batched insert,
 * with conflict handling to avoid duplicates.
 *
 * @param {PoolClient} client - The database client used for the transaction.
 * @param {Array<any>} rows - An array of attribute rows to insert.
 * @returns {Promise<void>} A promise that resolves when the operation is complete.
 */
export async function flushAttrs(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows.length) return;
  const cols = ['tx_hash', 'msg_index', 'event_index', 'key', 'value'];
  await execBatchedInsert(
    client,
    'core.event_attrs',
    cols,
    rows,
    'ON CONFLICT (tx_hash, msg_index, event_index, key) DO NOTHING',
    undefined,
    { maxRows: 10000, maxParams: 30000 },
  );
}
