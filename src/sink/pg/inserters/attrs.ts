// src/sink/pg/inserters/attrs.ts
import type { PoolClient } from 'pg';
import { makeMultiInsert } from '../batch.ts';

/**
 * Inserts flattened event attributes into the `core.event_attrs` table in a single transaction.
 *
 * Uses `makeMultiInsert` to build a multi-row insert statement with ON CONFLICT DO NOTHING,
 * ensuring idempotent writes for event attributes.
 *
 * @param client - Active PostgreSQL client connection from a connection pool.
 * @param rows - Array of attribute rows to insert. Each row should match the column order:
 *               [tx_hash, msg_index, event_index, key, value].
 * @returns Resolves when the insert operation completes.
 */
/** Single-transaction insert for flattened event attributes (block-atomic mode). */
export async function insertAttrs(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows?.length) return;
  const cols = ['tx_hash', 'msg_index', 'event_index', 'key', 'value'];
  const { text, values } = makeMultiInsert(
    'core.event_attrs',
    cols,
    rows,
    'ON CONFLICT (tx_hash, msg_index, event_index, key) DO NOTHING',
  );
  await client.query(text, values);
}
