// src/sink/pg/inserters/stake_deleg.ts
import type { PoolClient } from 'pg';
import { makeMultiInsert } from '../batch.ts';

/**
 * Inserts multiple rows into the `stake.delegation_events` table (partitioned by height).
 *
 * @param client - PoolClient from `pg`, used to execute the SQL insert.
 * @param rows - An array of row objects containing the delegation event data to insert.
 * @returns A Promise that resolves when the insert is complete.
 *
 * If `rows` is empty or not provided, the function returns early without executing any query.
 */
export async function insertStakeDeleg(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows?.length) return;
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
  const { text, values } = makeMultiInsert(
    'stake.delegation_events',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash, msg_index) DO NOTHING',
  );
  await client.query(text, values);
}
