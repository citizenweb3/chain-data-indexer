// src/sink/pg/flushers/wasm_exec.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';
import { dedupeCopyRows, execCopyFrom } from '../copy.js';

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
export async function flushWasmExec(client: PoolClient, rows: any[], opts?: { useCopy?: boolean }): Promise<void> {
  if (!rows.length) return;
  if (opts?.useCopy) {
    const dedupedRows = dedupeCopyRows(
      rows,
      (row) => `${row.height}\x1f${row.tx_hash}\x1f${row.msg_index}`,
    );
    await execCopyFrom(
      client,
      'wasm.executions',
      [
        { name: 'tx_hash', value: (row) => row.tx_hash },
        { name: 'msg_index', value: (row) => row.msg_index },
        { name: 'contract', value: (row) => row.contract },
        { name: 'caller', value: (row) => row.caller },
        { name: 'funds', value: (row) => row.funds },
        { name: 'msg', value: (row) => row.msg },
        { name: 'success', value: (row) => row.success },
        { name: 'error', value: (row) => row.error },
        { name: 'gas_used', value: (row) => row.gas_used },
        { name: 'height', value: (row) => row.height },
      ],
      dedupedRows,
      { maxRows: 5000 },
    );
    return;
  }
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
