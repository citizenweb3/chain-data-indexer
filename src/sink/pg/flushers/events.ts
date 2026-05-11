// src/sink/pg/flushers/events.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';
import { dedupeCopyRows, execCopyFrom } from '../copy.js';

/**
 * Flushes event rows into the `core.events` PostgreSQL table using batched insert.
 * Sets local statement and lock timeouts, and ignores conflicts on duplicate keys.
 *
 * @param {PoolClient} client - The PostgreSQL client connection used to execute queries.
 * @param {any[]} rows - The array of event rows to insert into the database.
 * @returns {Promise<void>} A Promise that resolves when the insert operations are complete.
 */
export async function flushEvents(client: PoolClient, rows: any[], opts?: { useCopy?: boolean }): Promise<void> {
  if (!rows.length) return;
  if (opts?.useCopy) {
    const dedupedRows = dedupeCopyRows(
      rows,
      (row) => `${row.height}\x1f${row.tx_hash}\x1f${row.msg_index}\x1f${row.event_index}`,
    );
    await execCopyFrom(
      client,
      'core.events',
      [
        { name: 'tx_hash', value: (row) => row.tx_hash },
        { name: 'msg_index', value: (row) => row.msg_index },
        { name: 'event_index', value: (row) => row.event_index },
        { name: 'event_type', value: (row) => row.event_type },
        { name: 'attributes', value: (row) => row.attributes },
        { name: 'height', value: (row) => row.height },
      ],
      dedupedRows,
      { maxRows: 5000 },
    );
    return;
  }
  const cols = ['height', 'tx_hash', 'msg_index', 'event_index', 'event_type', 'attributes'];
  await execBatchedInsert(
    client,
    'core.events',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash, msg_index, event_index) DO NOTHING',
    { attributes: 'jsonb' },
    { maxRows: 5000, maxParams: 30000 },
  );
}
