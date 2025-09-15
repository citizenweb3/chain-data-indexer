// src/sink/pg/inserters/wasm_events.ts
import type { PoolClient } from 'pg';
import { makeMultiInsert } from '../batch.ts';

/**
 * Inserts multiple rows into the partitioned `wasm.events` table.
 *
 * This function constructs and executes a multi-row insert statement
 * for WASM event records. It performs an "ON CONFLICT DO NOTHING"
 * to skip duplicate entries based on the unique key
 * (height, tx_hash, msg_index, event_type).
 *
 * @param client - PostgreSQL connection pool client used to execute the insert.
 * @param rows - Array of WASM event objects to be inserted. Each row should contain
 *               the columns: contract, height, tx_hash, msg_index, event_type, attributes.
 *               If the array is empty or undefined, the function returns immediately.
 * @returns Promise that resolves when the insert operation completes.
 */
export async function insertWasmEvents(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows?.length) return;
  const cols = ['contract', 'height', 'tx_hash', 'msg_index', 'event_type', 'attributes'];
  const { text, values } = makeMultiInsert(
    'wasm.events',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash, msg_index, event_type) DO NOTHING',
  );
  await client.query(text, values);
}
