// src/sink/pg/flushers/wasm_events.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';

/**
 * Flushes a batch of WASM events into the Postgres database.
 *
 * @param {PoolClient} client - The Postgres client used to execute insert queries.
 * @param {Array<any>} rows - An array of event records to insert.
 * @returns {Promise<void>} A promise that resolves when the flush operation is complete.
 *
 * Notes:
 * - Sets statement timeout to 30 seconds and lock timeout to 5 seconds for the transaction.
 * - Conflicts on (height, tx_hash, msg_index, event_type) are ignored to prevent duplicate inserts.
 */
export async function flushWasmEvents(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows.length) return;
  await client.query(`SET LOCAL statement_timeout = '30s'`);
  await client.query(`SET LOCAL lock_timeout = '5s'`);
  const cols = ['contract', 'height', 'tx_hash', 'msg_index', 'event_type', 'attributes'];
  await execBatchedInsert(
    client,
    'wasm.events',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash, msg_index, event_type) DO NOTHING',
    { attributes: 'jsonb' },
    { maxRows: 5000, maxParams: 30000 },
  );
}
