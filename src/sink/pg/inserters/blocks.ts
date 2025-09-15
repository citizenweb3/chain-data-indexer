// src/sink/pg/inserters/blocks.ts
import type { PoolClient } from 'pg';
import { makeMultiInsert } from '../batch.ts';

/**
 * Insert multiple block records into the core.blocks table in a single transaction, skipping duplicates.
 * @param client - PostgreSQL PoolClient instance used to execute the query.
 * @param rows - Array of block record objects to insert.
 * @returns Promise that resolves when the insertion is complete.
 */
export async function insertBlocks(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows?.length) return;
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
  const { text, values } = makeMultiInsert('core.blocks', cols, rows, 'ON CONFLICT (height) DO NOTHING');
  await client.query(text, values);
}
