// src/sink/pg/flushers/blocks.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';
import { dedupeCopyRows, execCopyFrom } from '../copy.js';

/**
 * Inserts a batch of block records into the core.blocks table.
 *
 * @param client - PostgreSQL PoolClient instance used for executing the insert.
 * @param rows - Array of block data rows to be inserted. Each row must match the columns defined in cols.
 * @returns Promise that resolves when the insert operation completes.
 */
export async function flushBlocks(client: PoolClient, rows: any[], opts?: { useCopy?: boolean }): Promise<void> {
  if (!rows.length) return;
  if (opts?.useCopy) {
    const dedupedRows = dedupeCopyRows(rows, (row) => `${row.height}`);
    await execCopyFrom(
      client,
      'core.blocks',
      [
        { name: 'height', value: (row) => row.height },
        { name: 'block_hash', value: (row) => row.block_hash },
        { name: 'time', value: (row) => row.time },
        { name: 'proposer_address', value: (row) => row.proposer_address },
        { name: 'tx_count', value: (row) => row.tx_count },
        { name: 'size_bytes', value: (row) => row.size_bytes },
        { name: 'last_commit_hash', value: (row) => row.last_commit_hash },
        { name: 'data_hash', value: (row) => row.data_hash },
        { name: 'evidence_count', value: (row) => row.evidence_count },
        { name: 'app_hash', value: (row) => row.app_hash },
      ],
      dedupedRows,
      { maxRows: 5000 },
    );
    return;
  }
  const cols = [
    'height',
    'block_hash',
    'time',
    'proposer_address',
    'tx_count',
    'size_bytes',
    'last_commit_hash',
    'data_hash',
    'evidence_count',
    'app_hash',
  ];
  await execBatchedInsert(client, 'core.blocks', cols, rows, 'ON CONFLICT (height) DO NOTHING', undefined, {
    maxRows: 5000,
    maxParams: 30000,
  });
}
