// src/sink/pg/flushers/wasm_exec.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';

/**
 * Flushes a batch of wasm execution rows into the postgres database.
 *
 * @param client - PostgreSQL PoolClient used to run queries inside a transaction or connection.
 * @param rows - Array of wasm execution rows to be inserted.
 * @returns Promise<void>
 *
 * Note: Sets local statement and lock timeouts before the batched insert.
 * Uses ON CONFLICT DO NOTHING to avoid duplicate inserts.
 */
export async function flushWasmExec(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows.length) return;
  await client.query(`SET LOCAL statement_timeout = '30s'`);
  await client.query(`SET LOCAL lock_timeout = '5s'`);
  const cols = ['tx_hash', 'msg_index', 'contract', 'caller', 'funds', 'msg', 'success', 'error', 'gas_used', 'height'];
  await execBatchedInsert(
    client,
    'wasm.executions',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash, msg_index) DO NOTHING',
    { funds: 'jsonb', msg: 'jsonb' },
    { maxRows: 5000, maxParams: 30000 },
  );
}
