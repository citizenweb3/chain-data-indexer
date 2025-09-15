// src/sink/pg/flushers/events.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';

/**
 * Flushes event rows into the `core.events` PostgreSQL table using batched insert.
 * Sets local statement and lock timeouts, and ignores conflicts on duplicate keys.
 *
 * @param {PoolClient} client - The PostgreSQL client connection used to execute queries.
 * @param {any[]} rows - The array of event rows to insert into the database.
 * @returns {Promise<void>} A Promise that resolves when the insert operations are complete.
 */
export async function flushEvents(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows.length) return;
  await client.query(`SET LOCAL statement_timeout = '30s'`);
  await client.query(`SET LOCAL lock_timeout = '5s'`);
  const cols = ['tx_hash', 'msg_index', 'event_index', 'event_type', 'attributes'];
  await execBatchedInsert(
    client,
    'core.events',
    cols,
    rows,
    'ON CONFLICT (tx_hash, msg_index, event_index) DO NOTHING',
    { attributes: 'jsonb' },
    { maxRows: 10000, maxParams: 20000 },
  );
}
