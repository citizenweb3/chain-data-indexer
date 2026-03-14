// src/sink/pg/flushers/msgs.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';
import { dedupeCopyRows, execCopyFrom } from '../copy.js';

/**
 * Flushes message rows into the `core.messages` table using batched insert.
 *
 * @param client - PostgreSQL PoolClient used for database operations.
 * @param rows - Array of message rows to insert.
 * @returns Promise that resolves when the operation completes.
 */
export async function flushMsgs(client: PoolClient, rows: any[], opts?: { useCopy?: boolean }): Promise<void> {
  if (!rows.length) return;
  if (opts?.useCopy) {
    const dedupedRows = dedupeCopyRows(
      rows,
      (row) => `${row.height}\x1f${row.tx_hash}\x1f${row.msg_index}`,
    );
    await execCopyFrom(
      client,
      'core.messages',
      [
        { name: 'tx_hash', value: (row) => row.tx_hash },
        { name: 'msg_index', value: (row) => row.msg_index },
        { name: 'height', value: (row) => row.height },
        { name: 'type_url', value: (row) => row.type_url },
        { name: 'value', value: (row) => row.value },
        { name: 'signer', value: (row) => row.signer },
      ],
      dedupedRows,
      { maxRows: 5000 },
    );
    return;
  }
  const cols = ['tx_hash', 'msg_index', 'height', 'type_url', 'value', 'signer'];
  await execBatchedInsert(
    client,
    'core.messages',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash, msg_index) DO NOTHING',
    { value: 'jsonb' },
    { maxRows: 5000, maxParams: 30000 },
  );
}
