// src/sink/pg/flushers/wasm_events.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';
import { dedupeCopyRows, execCopyFrom } from '../copy.js';

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
export async function flushWasmEvents(client: PoolClient, rows: any[], opts?: { useCopy?: boolean }): Promise<void> {
  if (!rows.length) return;
  if (opts?.useCopy) {
    const dedupedRows = dedupeCopyRows(
      rows,
      (row) => `${row.height}\x1f${row.tx_hash}\x1f${row.msg_index}\x1f${row.event_type}`,
    );
    await execCopyFrom(
      client,
      'wasm.events',
      [
        { name: 'contract', value: (row) => row.contract },
        { name: 'height', value: (row) => row.height },
        { name: 'tx_hash', value: (row) => row.tx_hash },
        { name: 'msg_index', value: (row) => row.msg_index },
        { name: 'event_type', value: (row) => row.event_type },
        { name: 'attributes', value: (row) => row.attributes },
      ],
      dedupedRows,
      { maxRows: 5000 },
    );
    return;
  }
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
