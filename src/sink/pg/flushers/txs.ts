// src/sink/pg/flushers/txs.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';
import { dedupeCopyRows, execCopyFrom } from '../copy.js';

/**
 * Inserts or updates transaction records in the core.transactions table in batches.
 *
 * This function uses a batched insert to efficiently persist transaction data.
 * If a transaction with the same height and tx_hash already exists, it updates
 * the gas_used and log_summary fields.
 *
 * @param client - A PostgreSQL PoolClient instance to execute queries.
 * @param rows - An array of transaction objects to be inserted or updated.
 * @returns A Promise that resolves when the operation is complete.
 */
export async function flushTxs(client: PoolClient, rows: any[], opts?: { useCopy?: boolean }): Promise<void> {
  if (!rows.length) return;
  if (opts?.useCopy) {
    const dedupedRows = dedupeCopyRows(rows, (row) => `${row.height}\x1f${row.tx_hash}`);
    await execCopyFrom(
      client,
      'core.transactions',
      [
        { name: 'tx_hash', value: (row) => row.tx_hash },
        { name: 'height', value: (row) => row.height },
        { name: 'tx_index', value: (row) => row.tx_index },
        { name: 'code', value: (row) => row.code },
        { name: 'gas_wanted', value: (row) => row.gas_wanted },
        { name: 'gas_used', value: (row) => row.gas_used },
        { name: 'fee', value: (row) => row.fee },
        { name: 'memo', value: (row) => row.memo },
        {
          name: 'signers',
          value: (row) =>
            Array.isArray(row.signers) ? `{${row.signers.map((s: string) => `"${s}"`).join(',')}}` : row.signers,
        },
        { name: 'raw_tx', value: (row) => row.raw_tx },
        { name: 'log_summary', value: (row) => row.log_summary },
        { name: 'time', value: (row) => row.time },
      ],
      dedupedRows,
      { maxRows: 2000 },
    );
    return;
  }
  const cols = [
    'tx_hash',
    'height',
    'tx_index',
    'code',
    'gas_wanted',
    'gas_used',
    'fee',
    'memo',
    'signers',
    'raw_tx',
    'log_summary',
    'time',
  ];
  await execBatchedInsert(
    client,
    'core.transactions',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash) DO UPDATE SET gas_used = EXCLUDED.gas_used, log_summary = EXCLUDED.log_summary',
    { fee: 'jsonb', raw_tx: 'jsonb' },
    { maxRows: 2000, maxParams: 30000 },
  );
}
