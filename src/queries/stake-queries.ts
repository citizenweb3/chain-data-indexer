import { db } from '@/db/indexer-db';

export interface DelegationEventRow {
  delegator_address: string;
  amount: string;
  denom: string;
  height: bigint;
  tx_index: number;
  msg_index: number;
  tx_hash: string;
  time: Date;
}

export async function queryDelegationsByValidator(params: {
  validator: string;
  limit: number;
  beforeHeight?: bigint;
  beforeIndex?: number;
  beforeMsgIndex?: number;
}): Promise<DelegationEventRow[]> {
  const { validator, limit, beforeHeight, beforeIndex, beforeMsgIndex } = params;
  const fetch = limit + 1;

  if (beforeHeight !== undefined && beforeIndex !== undefined && beforeMsgIndex !== undefined) {
    return db<DelegationEventRow[]>`
      SELECT
        de.delegator_address,
        de.amount::text AS amount,
        de.denom,
        de.height,
        t.tx_index,
        de.msg_index,
        de.tx_hash,
        t.time
      FROM stake.delegation_events de
      JOIN core.transactions t
        ON t.height = de.height AND t.tx_hash = de.tx_hash
      WHERE de.validator_dst = ${validator}
        AND de.event_type = 'delegate'
        AND t.code = 0
        -- AtomOne raw_log can duplicate delegate events as message-level rows plus tx-level -1 rows.
        -- Keep the message-level row when an exact sibling exists; keep -1-only rows.
        AND NOT (
          de.msg_index = -1
          AND EXISTS (
            SELECT 1
            FROM stake.delegation_events s
            WHERE s.height = de.height
              AND s.tx_hash = de.tx_hash
              AND s.event_type = 'delegate'
              AND s.msg_index >= 0
              AND s.validator_dst IS NOT DISTINCT FROM de.validator_dst
              AND s.delegator_address IS NOT DISTINCT FROM de.delegator_address
              AND s.amount IS NOT DISTINCT FROM de.amount
              AND s.denom IS NOT DISTINCT FROM de.denom
          )
        )
        AND (de.height, t.tx_index, de.msg_index) < (${beforeHeight}, ${beforeIndex}, ${beforeMsgIndex})
      ORDER BY de.height DESC, t.tx_index DESC, de.msg_index DESC
      LIMIT ${fetch}
    `;
  }

  return db<DelegationEventRow[]>`
    SELECT
      de.delegator_address,
      de.amount::text AS amount,
      de.denom,
      de.height,
      t.tx_index,
      de.msg_index,
      de.tx_hash,
      t.time
    FROM stake.delegation_events de
    JOIN core.transactions t
      ON t.height = de.height AND t.tx_hash = de.tx_hash
    WHERE de.validator_dst = ${validator}
      AND de.event_type = 'delegate'
      AND t.code = 0
      -- AtomOne raw_log can duplicate delegate events as message-level rows plus tx-level -1 rows.
      -- Keep the message-level row when an exact sibling exists; keep -1-only rows.
      AND NOT (
        de.msg_index = -1
        AND EXISTS (
          SELECT 1
          FROM stake.delegation_events s
          WHERE s.height = de.height
            AND s.tx_hash = de.tx_hash
            AND s.event_type = 'delegate'
            AND s.msg_index >= 0
            AND s.validator_dst IS NOT DISTINCT FROM de.validator_dst
            AND s.delegator_address IS NOT DISTINCT FROM de.delegator_address
            AND s.amount IS NOT DISTINCT FROM de.amount
            AND s.denom IS NOT DISTINCT FROM de.denom
        )
      )
    ORDER BY de.height DESC, t.tx_index DESC, de.msg_index DESC
    LIMIT ${fetch}
  `;
}
