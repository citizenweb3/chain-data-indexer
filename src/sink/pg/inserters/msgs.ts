// src/sink/pg/inserters/msgs.ts
import type { PoolClient } from 'pg';
import { makeMultiInsert } from '../batch.ts';

/**
 * Inserts multiple message records into the `core.messages` table in a single transaction (block-atomic mode).
 *
 * @param {PoolClient} client - The Postgres client to use for executing the insert.
 * @param {any[]} rows - Array of message rows to insert.
 * @returns {Promise<void>} - Resolves when the insert operation is complete.
 *
 * If `rows` is empty or not provided, the function returns immediately without running a query.
 */
export async function insertMsgs(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows?.length) return;
  const cols = ['tx_hash', 'msg_index', 'height', 'type_url', 'value', 'signer'];
  const { text, values } = makeMultiInsert(
    'core.messages',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash, msg_index) DO NOTHING',
  );
  await client.query(text, values);
}
