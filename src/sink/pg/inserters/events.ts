// src/sink/pg/inserters/events.ts
import type { PoolClient } from 'pg';
import { makeMultiInsert } from '../batch.ts';

/**
 * Inserts multiple event records into the `core.events` table in a single transaction (block-atomic mode).
 *
 * @param client - PoolClient – a PostgreSQL client instance to execute the insert.
 * @param rows - any[] – an array of event row objects to insert.
 * @returns Promise<void> – resolves when the insertion is complete.
 *
 * If `rows` is empty, this function performs no action.
 */
export async function insertEvents(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows?.length) return;
  const cols = ['tx_hash', 'msg_index', 'event_index', 'event_type', 'attributes'];
  const { text, values } = makeMultiInsert(
    'core.events',
    cols,
    rows,
    'ON CONFLICT (tx_hash, msg_index, event_index) DO NOTHING',
  );
  await client.query(text, values);
}
