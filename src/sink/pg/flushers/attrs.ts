// src/sink/pg/flushers/attrs.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';
import { dedupeCopyRows, execCopyFrom } from '../copy.js';

/**
 * Flushes event attribute rows to the `core.event_attrs` table using batched insert,
 * with conflict handling to avoid duplicates.
 *
 * @param {PoolClient} client - The database client used for the transaction.
 * @param {Array<any>} rows - An array of attribute rows to insert.
 * @returns {Promise<void>} A promise that resolves when the operation is complete.
 */
export async function flushAttrs(client: PoolClient, rows: any[], opts?: { useCopy?: boolean }): Promise<void> {
  if (!rows.length) return;
  if (opts?.useCopy) {
    const dedupedRows = dedupeCopyRows(
      rows,
      (row) => `${row.height}\x1f${row.tx_hash}\x1f${row.msg_index}\x1f${row.event_index}\x1f${row.key}`,
    );
    await execCopyFrom(
      client,
      'core.event_attrs',
      [
        { name: 'height', value: (row) => row.height },
        { name: 'tx_hash', value: (row) => row.tx_hash },
        { name: 'msg_index', value: (row) => row.msg_index },
        { name: 'event_index', value: (row) => row.event_index },
        { name: 'key', value: (row) => row.key },
        { name: 'value', value: (row) => row.value },
      ],
      dedupedRows,
      { maxRows: 50000 },
    );
    return;
  }
  const cols = ['height', 'tx_hash', 'msg_index', 'event_index', 'key', 'value'];
  await execBatchedInsert(
    client,
    'core.event_attrs',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash, msg_index, event_index, key) DO NOTHING',
    undefined,
    { maxRows: 10000, maxParams: 30000 },
  );
}
