// src/sink/pg/flushers/stake_distr.ts
import type { PoolClient } from 'pg';
import { execBatchedInsert } from '../batch.js';
import { dedupeCopyRows, execCopyFrom } from '../copy.js';

/**
 * Flushes staking distribution events to the database in batches.
 *
 * @param client - PostgreSQL client for executing queries.
 * @param rows - Array of distribution event rows to insert.
 * @returns Promise<void>
 */

export async function flushStakeDistr(client: PoolClient, rows: any[], opts?: { useCopy?: boolean }): Promise<void> {
  if (!rows.length) return;
  if (opts?.useCopy) {
    const dedupedRows = dedupeCopyRows(
      rows,
      (row) => `${row.height}\x1f${row.tx_hash}\x1f${row.msg_index}`,
    );
    await execCopyFrom(
      client,
      'stake.distribution_events',
      [
        { name: 'height', value: (row) => row.height },
        { name: 'tx_hash', value: (row) => row.tx_hash },
        { name: 'msg_index', value: (row) => row.msg_index },
        { name: 'event_type', value: (row) => row.event_type },
        { name: 'delegator_address', value: (row) => row.delegator_address },
        { name: 'validator_address', value: (row) => row.validator_address },
        { name: 'denom', value: (row) => row.denom },
        { name: 'amount', value: (row) => row.amount },
        { name: 'withdraw_address', value: (row) => row.withdraw_address },
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
    'validator_address',
    'denom',
    'amount',
    'withdraw_address',
  ];
  await execBatchedInsert(
    client,
    'stake.distribution_events',
    cols,
    rows,
    'ON CONFLICT (height, tx_hash, msg_index) DO NOTHING',
    undefined,
    { maxRows: 5000, maxParams: 30000 },
  );
}
