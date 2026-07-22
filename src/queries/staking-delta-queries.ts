import { db } from '@/db/indexer-db';

export type StakingDeltaEventType =
  | 'delegate'
  | 'redelegate'
  | 'unbond'
  | 'create_validator'
  | 'cancel_unbonding_delegation';

export interface StakingDeltaRow {
  height: bigint;
  tx_index: number;
  msg_index: number;
  tx_hash: string;
  time: Date;
  event_type: StakingDeltaEventType;
  validator_src: string | null;
  validator_dst: string | null;
  denom: string;
  amount: string;
  sign: 1 | -1 | 0;
  source: 'event' | 'message';
}

export interface StakingDeltaStatsRow {
  total: bigint;
  skipped_ambiguous_msgexec: bigint;
}

export interface StakingDeltaQueryParams {
  delegator: string;
  limit: number;
  beforeHeight?: bigint;
  beforeIndex?: number;
  beforeMsgIndex?: number;
}

// Reads from stake.delegator_staking_deltas, a precomputed table resolving authz-wrapped
// staking messages ahead of time (backfilled once, refreshed incrementally by a cron job).
// Keeps this endpoint an indexed point lookup regardless of how many authz batches a
// delegator has, instead of resolving them on every request.
export const queryStakingDeltas = async (params: StakingDeltaQueryParams): Promise<StakingDeltaRow[]> => {
  const { delegator, limit, beforeHeight, beforeIndex, beforeMsgIndex } = params;
  const cursor =
    beforeHeight !== undefined && beforeIndex !== undefined && beforeMsgIndex !== undefined
      ? db`AND (height, tx_index, msg_index) < (${beforeHeight}, ${beforeIndex}, ${beforeMsgIndex})`
      : db``;

  return db<StakingDeltaRow[]>`
    SELECT height, tx_index, msg_index, tx_hash, time, event_type,
      validator_src, validator_dst, denom, amount, sign, source
    FROM stake.delegator_staking_deltas
    WHERE delegator_address = ${delegator}
    ${cursor}
    ORDER BY height DESC, tx_index DESC, msg_index DESC
    LIMIT ${limit + 1}
  `;
};

export const queryStakingDeltaStats = async (delegator: string): Promise<StakingDeltaStatsRow> => {
  const rows = await db<StakingDeltaStatsRow[]>`
    SELECT total, skipped_ambiguous_msgexec
    FROM stake.delegator_staking_delta_stats
    WHERE delegator_address = ${delegator}
  `;

  return rows[0] ?? { total: BigInt(0), skipped_ambiguous_msgexec: BigInt(0) };
};
