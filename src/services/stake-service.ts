import { queryDelegationsByValidator, type DelegationsQuery } from '@/queries/stake-queries';

export interface DelegationEventDto {
  delegator_address: string;
  amount: string;
  denom: string;
  height: string;
  tx_index: number;
  msg_index: number;
  tx_hash: string;
  time: string;
}

export interface DelegationsCursor {
  next_before_height: string;
  next_before_index: number;
  next_before_msg_index: number;
  next_before_amount?: string;
}

export interface DelegationsResult {
  data: DelegationEventDto[];
  cursor: DelegationsCursor | null;
  has_more: boolean;
  total: '0';
}

export async function listDelegations(params: DelegationsQuery): Promise<DelegationsResult> {
  const rows = await queryDelegationsByValidator(params);
  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;

  const data = page.map((row) => ({
    delegator_address: row.delegator_address,
    amount: row.amount,
    denom: row.denom,
    height: row.height.toString(),
    tx_index: row.tx_index,
    msg_index: row.msg_index,
    tx_hash: row.tx_hash,
    time: row.time.toISOString(),
  }));

  const last = page.at(-1);
  let cursor: DelegationsCursor | null = null;
  if (hasMore && last !== undefined) {
    const timeCursor = {
      next_before_height: last.height.toString(),
      next_before_index: last.tx_index,
      next_before_msg_index: last.msg_index,
    };
    cursor = params.sort === 'amount' ? { ...timeCursor, next_before_amount: last.amount } : timeCursor;
  }

  return { data, cursor, has_more: hasMore, total: '0' };
}
