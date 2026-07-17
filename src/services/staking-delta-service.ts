import { CHAIN_ACCOUNT_PREFIX } from '@/chain-config';
import { toValoperAddress } from '@/lib/cosmos-address';
import {
  queryStakingDeltas,
  queryStakingDeltaStats,
  type StakingDeltaQueryParams,
  type StakingDeltaRow,
} from '@/queries/staking-delta-queries';

const toDto = (row: StakingDeltaRow) => ({
  height: row.height.toString(),
  tx_index: row.tx_index,
  msg_index: row.msg_index,
  tx_hash: row.tx_hash,
  time: row.time.toISOString(),
  event_type: row.event_type,
  validator_src: row.validator_src,
  validator_dst: row.validator_dst,
  denom: row.denom,
  amount: row.amount,
  sign: row.sign,
  source: row.source,
});

type ListStakingDeltasParams = Omit<StakingDeltaQueryParams, 'valoper'>;

export const listStakingDeltas = async (params: ListStakingDeltasParams) => {
  const valoper = toValoperAddress(params.delegator, CHAIN_ACCOUNT_PREFIX);
  const [rows, stats] = await Promise.all([
    queryStakingDeltas({ ...params, valoper }),
    queryStakingDeltaStats(params.delegator, valoper),
  ]);
  const hasMore = rows.length > params.limit;
  const pageRows = hasMore ? rows.slice(0, params.limit) : rows;
  const last = pageRows.at(-1);

  return {
    data: pageRows.map(toDto),
    cursor:
      hasMore && last
        ? {
            next_before_height: last.height.toString(),
            next_before_index: last.tx_index,
            next_before_msg_index: last.msg_index,
          }
        : null,
    has_more: hasMore,
    total: stats.total.toString(),
    meta: { skipped_ambiguous_msgexec: stats.skipped_ambiguous_msgexec.toString() },
  };
};
