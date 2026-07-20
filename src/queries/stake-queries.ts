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

type DelegationOrder = 'asc' | 'desc';

interface DelegationTimeCursor {
  beforeHeight: bigint;
  beforeIndex: number;
  beforeMsgIndex: number;
}

interface DelegationAmountCursor extends DelegationTimeCursor {
  // Digit string bound with an explicit ::numeric cast — a bigint param would be typed int8
  // by the driver and overflow for amounts beyond 19 digits (column is NUMERIC(80,0)).
  beforeAmount: string;
}

interface DelegationsQueryBase {
  validator: string;
  limit: number;
  order: DelegationOrder;
}

interface TimeDelegationsQuery extends DelegationsQueryBase {
  sort: 'time';
  cursor?: DelegationTimeCursor;
}

interface AmountDelegationsQuery extends DelegationsQueryBase {
  sort: 'amount';
  cursor?: DelegationAmountCursor;
}

export type DelegationsQuery = TimeDelegationsQuery | AmountDelegationsQuery;

export async function queryDelegationsByValidator(params: DelegationsQuery): Promise<DelegationEventRow[]> {
  const fetch = params.limit + 1;
  const isAscending = params.order === 'asc';

  const cursorFilter = (() => {
    if (!params.cursor) return db``;

    if (params.sort === 'amount') {
      const { beforeAmount, beforeHeight, beforeIndex, beforeMsgIndex } = params.cursor;
      return isAscending
        ? db`AND (de.amount, de.height, t.tx_index, de.msg_index) > (${beforeAmount}::numeric, ${beforeHeight}, ${beforeIndex}, ${beforeMsgIndex})`
        : db`AND (de.amount, de.height, t.tx_index, de.msg_index) < (${beforeAmount}::numeric, ${beforeHeight}, ${beforeIndex}, ${beforeMsgIndex})`;
    }

    const { beforeHeight, beforeIndex, beforeMsgIndex } = params.cursor;
    return isAscending
      ? db`AND (de.height, t.tx_index, de.msg_index) > (${beforeHeight}, ${beforeIndex}, ${beforeMsgIndex})`
      : db`AND (de.height, t.tx_index, de.msg_index) < (${beforeHeight}, ${beforeIndex}, ${beforeMsgIndex})`;
  })();

  const getOrderBy = () => {
    if (params.sort === 'amount') {
      if (isAscending) {
        return db`ORDER BY de.amount ASC, de.height ASC, t.tx_index ASC, de.msg_index ASC`;
      }
      return db`ORDER BY de.amount DESC, de.height DESC, t.tx_index DESC, de.msg_index DESC`;
    }

    if (isAscending) {
      return db`ORDER BY de.height ASC, t.tx_index ASC, de.msg_index ASC`;
    }
    return db`ORDER BY de.height DESC, t.tx_index DESC, de.msg_index DESC`;
  };
  const orderBy = getOrderBy();

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
    WHERE de.validator_dst = ${params.validator}
      AND de.event_type = 'delegate'
      AND t.code = 0
    ${cursorFilter}
    ${orderBy}
    LIMIT ${fetch}
  `;
}
