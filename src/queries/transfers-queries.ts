import { db } from '@/db/indexer-db';
import { TEXT_ARRAY_OID } from '@/db/postgres-types';

export interface TransferRow {
  height: bigint;
  tx_hash: string;
  msg_index: number;
  from_addr: string;
  to_addr: string;
  denom: string;
  amount: string;
  time: Date;
}

export interface TransfersByAddressCursor {
  beforeHeight: bigint;
  beforeTxHash: string;
  beforeMsgIndex: number;
  beforeFromAddr: string;
  beforeToAddr: string;
  beforeDenom: string;
}

export interface TransfersByAddressParams {
  addresses: string[];
  limit: number;
  cursor?: TransfersByAddressCursor;
}

// Address-scoped transfer feed. Both branches ride their composite (addr, height DESC) btrees,
// so the ordered probe stops early instead of walking the partition set; the full-primary-key
// row comparison keeps keyset pagination exact even when one message emits several coin rows.
// The cursor predicate sits INSIDE each branch, before its LIMIT.
export async function queryTransfersByAddress(params: TransfersByAddressParams): Promise<TransferRow[]> {
  const { addresses, limit, cursor } = params;
  const fetch = limit + 1;
  const cursorFragment = cursor
    ? db`AND (t.height, t.tx_hash, t.msg_index, t.from_addr, t.to_addr, t.denom) <
        (${cursor.beforeHeight}, ${cursor.beforeTxHash}, ${cursor.beforeMsgIndex},
         ${cursor.beforeFromAddr}, ${cursor.beforeToAddr}, ${cursor.beforeDenom})`
    : db``;

  return db<TransferRow[]>`
    WITH candidates AS (
      (
        SELECT t.height, t.tx_hash, t.msg_index, t.from_addr, t.to_addr, t.denom, t.amount::text AS amount
        FROM bank.transfers t
        WHERE t.from_addr = ANY(${db.array(addresses, TEXT_ARRAY_OID)})
          ${cursorFragment}
        ORDER BY t.height DESC, t.tx_hash DESC, t.msg_index DESC, t.from_addr DESC, t.to_addr DESC, t.denom DESC
        LIMIT ${fetch}
      )
      UNION
      (
        SELECT t.height, t.tx_hash, t.msg_index, t.from_addr, t.to_addr, t.denom, t.amount::text AS amount
        FROM bank.transfers t
        WHERE t.to_addr = ANY(${db.array(addresses, TEXT_ARRAY_OID)})
          ${cursorFragment}
        ORDER BY t.height DESC, t.tx_hash DESC, t.msg_index DESC, t.from_addr DESC, t.to_addr DESC, t.denom DESC
        LIMIT ${fetch}
      )
    ),
    page AS (
      SELECT height, tx_hash, msg_index, from_addr, to_addr, denom, amount
      FROM candidates
      ORDER BY height DESC, tx_hash DESC, msg_index DESC, from_addr DESC, to_addr DESC, denom DESC
      LIMIT ${fetch}
    )
    SELECT page.height, page.tx_hash, page.msg_index, page.from_addr, page.to_addr, page.denom,
      page.amount, tx.time
    FROM page
    JOIN core.transactions tx
      ON tx.height = page.height AND tx.tx_hash = page.tx_hash
    ORDER BY page.height DESC, page.tx_hash DESC, page.msg_index DESC, page.from_addr DESC,
      page.to_addr DESC, page.denom DESC
  `;
}
