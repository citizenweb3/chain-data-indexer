// src/sink/pg/inserters/wasm_exec.ts
import type { PoolClient } from 'pg';
import { makeMultiInsert } from '../batch.ts';

/**
 * Inserts multiple rows into the `wasm.executions` partitioned table, skipping conflicts.
 *
 * @param client - The PostgreSQL PoolClient used to perform the query.
 * @param rows - An array of objects representing the rows to insert.
 * @returns A Promise that resolves when the insert is complete.
 */
export async function insertWasmExec(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows?.length) return;
  const cols = ['tx_hash', 'msg_index', 'contract', 'caller', 'funds', 'msg', 'success', 'error', 'gas_used', 'height'];
  const { text, values } = makeMultiInsert(
    'wasm.executions',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash, msg_index) DO NOTHING',
  );
  await client.query(text, values);
}
