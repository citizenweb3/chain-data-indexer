// src/sink/pg/flushers/stake_deleg.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';

/**
 * Inserts stake delegation event rows into the stake.delegation_events table in batched mode.
 *
 * Applies local Postgres timeouts to prevent long-running locks and filters out any rows missing
 * required fields before insertion.
 *
 * @param client - An active pg PoolClient instance to execute the database queries.
 * @param rowsAll - Array of stake delegation event records to insert.
 * @returns Promise that resolves when the batch insert operation completes.
 */

export async function flushStakeDeleg(client: PoolClient, rowsAll: any[]): Promise<void> {
  if (!rowsAll.length) return;
  await client.query(`SET LOCAL statement_timeout = '30s'`);
  await client.query(`SET LOCAL lock_timeout = '5s'`);

  const rows = rowsAll.filter((r) => r && r.delegator_address && r.denom && r.amount && r.event_type);
  if (!rows.length) return;

  const cols = [
    'height',
    'tx_hash',
    'msg_index',
    'event_type',
    'delegator_address',
    'validator_src',
    'validator_dst',
    'denom',
    'amount',
    'completion_time',
  ];
  await execBatchedInsert(
    client,
    'stake.delegation_events',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash, msg_index) DO NOTHING',
    undefined,
    { maxRows: 5000, maxParams: 30000 },
  );
}
