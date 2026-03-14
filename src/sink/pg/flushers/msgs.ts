// src/sink/pg/flushers/msgs.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';

/**
 * Flushes message rows into the `core.messages` table using batched insert.
 *
 * @param client - PostgreSQL PoolClient used for database operations.
 * @param rows - Array of message rows to insert.
 * @returns Promise that resolves when the operation completes.
 */
export async function flushMsgs(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows.length) return;
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
