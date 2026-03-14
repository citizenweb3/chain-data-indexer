// src/sink/pg/flushers/transfers.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';
import { dedupeCopyRows, execCopyFrom } from '../copy.js';

/**
 * Flushes batched transfer rows into the `bank.transfers` table in Postgres.
 *
 * @param {PoolClient} client - The Postgres PoolClient used to execute queries.
 * @param {any[]} rows - An array of transfer records to insert.
 * @returns {Promise<void>} A Promise that resolves when the insert is complete.
 */
export async function flushTransfers(client: PoolClient, rows: any[], opts?: { useCopy?: boolean }): Promise<void> {
  if (!rows.length) return;
  if (opts?.useCopy) {
    const dedupedRows = dedupeCopyRows(
      rows,
      (row) => `${row.height}\x1f${row.tx_hash}\x1f${row.msg_index}\x1f${row.from_addr}\x1f${row.to_addr}\x1f${row.denom}`,
    );
    await execCopyFrom(
      client,
      'bank.transfers',
      [
        { name: 'tx_hash', value: (row) => row.tx_hash },
        { name: 'msg_index', value: (row) => row.msg_index },
        { name: 'from_addr', value: (row) => row.from_addr },
        { name: 'to_addr', value: (row) => row.to_addr },
        { name: 'denom', value: (row) => row.denom },
        { name: 'amount', value: (row) => row.amount },
        { name: 'height', value: (row) => row.height },
      ],
      dedupedRows,
      { maxRows: 5000 },
    );
    return;
  }
  const cols = ['tx_hash', 'msg_index', 'from_addr', 'to_addr', 'denom', 'amount', 'height'];
  await execBatchedInsert(
    client,
    'bank.transfers',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash, msg_index, from_addr, to_addr, denom) DO NOTHING',
    undefined,
    { maxRows: 5000, maxParams: 30000 },
  );
}
