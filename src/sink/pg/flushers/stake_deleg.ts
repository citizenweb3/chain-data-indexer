// src/sink/pg/flushers/stake_deleg.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';
import { dedupeCopyRows, execCopyFrom } from '../copy.js';

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

export async function flushStakeDeleg(client: PoolClient, rowsAll: any[], opts?: { useCopy?: boolean }): Promise<void> {
  if (!rowsAll.length) return;

  const rows = rowsAll.filter((r) => r && r.delegator_address && r.denom && r.amount && r.event_type);
  if (!rows.length) return;

  if (opts?.useCopy) {
    const dedupedRows = dedupeCopyRows(
      rows,
      (row) => `${row.height}\x1f${row.tx_hash}\x1f${row.msg_index}`,
    );
    await execCopyFrom(
      client,
      'stake.delegation_events',
      [
        { name: 'height', value: (row) => row.height },
        { name: 'tx_hash', value: (row) => row.tx_hash },
        { name: 'msg_index', value: (row) => row.msg_index },
        { name: 'event_type', value: (row) => row.event_type },
        { name: 'delegator_address', value: (row) => row.delegator_address },
        { name: 'validator_src', value: (row) => row.validator_src },
        { name: 'validator_dst', value: (row) => row.validator_dst },
        { name: 'denom', value: (row) => row.denom },
        { name: 'amount', value: (row) => row.amount },
        { name: 'completion_time', value: (row) => row.completion_time },
      ],
      dedupedRows,
      { maxRows: 5000 },
    );
    return;
  }
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
