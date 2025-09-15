// src/sink/pg/inserters/stake_distr.ts
import type { PoolClient } from 'pg';
import { makeMultiInsert } from '../batch.ts';

/** Insert rows into stake.distribution_events (partitioned by height). */
/**
 * Inserts multiple rows into the `stake.distribution_events` table, which is partitioned by height.
 *
 * @param {PoolClient} client - PostgreSQL PoolClient used to run the query.
 * @param {any[]} rows - Array of row objects to insert.
 * @returns {Promise<void>} Resolves when insertion is complete.
 *
 * If no rows are provided, the function returns early without executing a query.
 */
export async function insertStakeDistr(client: PoolClient, rows: any[]): Promise<void> {
  if (!rows?.length) return;
  const cols = [
    'height',
    'tx_hash',
    'msg_index',
    'event_type',
    'delegator_address',
    'validator_address',
    'denom',
    'amount',
    'withdraw_address',
  ];
  const { text, values } = makeMultiInsert(
    'stake.distribution_events',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash, msg_index) DO NOTHING',
  );
  await client.query(text, values);
}
