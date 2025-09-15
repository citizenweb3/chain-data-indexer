// src/sink/pg/flushers/blocks.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';

/**
 * Inserts a batch of block records into the core.blocks table.
 *
 * @param client - PostgreSQL PoolClient instance used for executing the insert.
 * @param rows - Array of block data rows to be inserted. Each row must match the columns defined in cols.
 * @returns Promise that resolves when the insert operation completes.
 */
export async function flushBlocks(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows.length) return;
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
