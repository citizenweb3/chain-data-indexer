import { db } from '@/db/indexer-db';

export interface TxSummaryRow {
  tx_hash: string;
  height: bigint;
  tx_index: number;
  time: Date;
  code: number;
  fee_amount: string | null;
  fee_denom: string | null;
  first_msg_type: string | null;
}

export interface TxTransferRow {
  from_addr: string;
  to_addr: string;
  denom: string;
  amount: string;
}

export interface TxByAddressSummaryRow extends TxSummaryRow {
  transfers: TxTransferRow[];
}

export interface TxsByAddressFilters {
  msgTypes?: string[];
  fromTime?: string;
  toTime?: string;
  minAmount?: string;
  maxAmount?: string;
  amountDenom?: string;
}

export interface TxsByAddressQueryParams extends TxsByAddressFilters {
  addresses: string[];
  limit: number;
  beforeHeight?: bigint;
  beforeIndex?: number;
}

export interface TxDetailRow {
  tx_hash: string;
  height: bigint;
  tx_index: number;
  time: Date;
  code: number;
  gas_wanted: bigint | null;
  gas_used: bigint | null;
  fee: unknown;
  memo: string | null;
  signers: string[] | null;
  log_summary: string | null;
}

export interface MessageRow {
  msg_index: number;
  type_url: string;
  value: unknown;
  signer: string | null;
}

export interface EventRow {
  msg_index: number;
  event_index: number;
  event_type: string;
  attributes: unknown;
}

export interface TxRawRow {
  raw_tx: unknown;
}

export async function queryTxsList(params: {
  limit: number;
  beforeHeight?: bigint;
  beforeIndex?: number;
}): Promise<TxSummaryRow[]> {
  const { limit, beforeHeight, beforeIndex } = params;
  // fetch limit+1 so the service can detect has_more
  const fetch = limit + 1;

  if (beforeHeight !== undefined && beforeIndex !== undefined) {
    return db<TxSummaryRow[]>`
      SELECT
        t.tx_hash,
        t.height,
        t.tx_index,
        t.time,
        t.code,
        t.fee->'amount'->0->>'amount' AS fee_amount,
        t.fee->'amount'->0->>'denom'  AS fee_denom,
        m.type_url AS first_msg_type
      FROM core.transactions t
      LEFT JOIN core.messages m
        ON m.height = t.height AND m.tx_hash = t.tx_hash AND m.msg_index = 0
      WHERE (t.height, t.tx_index) < (${beforeHeight}, ${beforeIndex})
      ORDER BY t.height DESC, t.tx_index DESC
      LIMIT ${fetch}
    `;
  }

  return db<TxSummaryRow[]>`
    SELECT
      t.tx_hash,
      t.height,
      t.tx_index,
      t.time,
      t.code,
      t.fee->'amount'->0->>'amount' AS fee_amount,
      t.fee->'amount'->0->>'denom'  AS fee_denom,
      m.type_url AS first_msg_type
    FROM core.transactions t
    LEFT JOIN core.messages m
      ON m.height = t.height AND m.tx_hash = t.tx_hash AND m.msg_index = 0
    ORDER BY t.height DESC, t.tx_index DESC
    LIMIT ${fetch}
  `;
}

// One safe predicate source is shared by the page and exact-count queries. Nested postgres.js
// fragments preserve parameterization while omitting absent filters from the generated SQL.
const buildTxsByAddressFilterFragment = (addresses: string[], filters: TxsByAddressFilters) => db`
  ${
    filters.msgTypes !== undefined
      ? db`AND EXISTS (
          SELECT 1
          FROM core.messages m2
          WHERE m2.height = t.height
            AND m2.tx_hash = t.tx_hash
            AND m2.type_url = ANY(${db.array(filters.msgTypes)})
        )`
      : db``
  }
  ${filters.fromTime !== undefined ? db`AND t.time >= ${filters.fromTime}` : db``}
  ${filters.toTime !== undefined ? db`AND t.time <= ${filters.toTime}` : db``}
  ${
    filters.amountDenom !== undefined
      ? db`AND EXISTS (
          SELECT 1
          FROM bank.transfers bf
          WHERE bf.height = t.height
            AND bf.tx_hash = t.tx_hash
            AND (bf.from_addr = ANY(${db.array(addresses)}) OR bf.to_addr = ANY(${db.array(addresses)}))
            AND bf.denom = ${filters.amountDenom}
            ${filters.minAmount !== undefined ? db`AND bf.amount >= ${filters.minAmount}` : db``}
            ${filters.maxAmount !== undefined ? db`AND bf.amount <= ${filters.maxAmount}` : db``}
        )`
      : db``
  }
`;

// Transactions involving one or more addresses (the indexer's `signers` is a grab-bag of actor
// fields). `&&` uses idx_txs_signers_gin. The LATERAL probe returns only transfers involving the
// requested addresses and applies a total order before the five-row cap.
export async function queryTxsByAddress(params: TxsByAddressQueryParams): Promise<TxByAddressSummaryRow[]> {
  const { addresses, limit, beforeHeight, beforeIndex, ...filters } = params;
  const fetch = limit + 1;
  const cursorFragment =
    beforeHeight !== undefined && beforeIndex !== undefined
      ? db`AND (t.height, t.tx_index) < (${beforeHeight}, ${beforeIndex})`
      : db``;
  const filterFragment = buildTxsByAddressFilterFragment(addresses, filters);

  return db<TxByAddressSummaryRow[]>`
    SELECT
      t.tx_hash,
      t.height,
      t.tx_index,
      t.time,
      t.code,
      t.fee->'amount'->0->>'amount' AS fee_amount,
      t.fee->'amount'->0->>'denom'  AS fee_denom,
      m.type_url AS first_msg_type,
      COALESCE(tr.transfers, '[]'::jsonb) AS transfers
    FROM core.transactions t
    LEFT JOIN core.messages m
      ON m.height = t.height AND m.tx_hash = t.tx_hash AND m.msg_index = 0
    LEFT JOIN LATERAL (
      SELECT jsonb_agg(transfer_row.payload ORDER BY transfer_row.msg_index, transfer_row.from_addr,
        transfer_row.to_addr, transfer_row.denom) AS transfers
      FROM (
        SELECT
          b.msg_index,
          b.from_addr,
          b.to_addr,
          b.denom,
          jsonb_build_object(
            'from_addr', b.from_addr,
            'to_addr', b.to_addr,
            'denom', b.denom,
            'amount', b.amount::text
          ) AS payload
        FROM bank.transfers b
        WHERE b.height = t.height
          AND b.tx_hash = t.tx_hash
          AND (b.from_addr = ANY(${db.array(addresses)}) OR b.to_addr = ANY(${db.array(addresses)}))
        ORDER BY b.msg_index, b.from_addr, b.to_addr, b.denom
        LIMIT 5
      ) transfer_row
    ) tr ON true
    WHERE t.signers && ${db.array(addresses)}
      ${filterFragment}
      ${cursorFragment}
    ORDER BY t.height DESC, t.tx_index DESC
    LIMIT ${fetch}
  `;
}

// Exact total over the address(es). An address's involved-tx set is narrow (the GIN bitmap returns
// few rows), so this COUNT is cheap — unlike the global table count (which uses the reltuples
// estimate in queryTxsTotal). `&&` matches the list predicate so the count agrees with the page; a
// tx matching several of the addresses is counted once (natural dedup).
export async function queryTxsByAddressTotal(
  params: Pick<TxsByAddressQueryParams, 'addresses'> & TxsByAddressFilters,
): Promise<bigint> {
  const { addresses, ...filters } = params;
  const filterFragment = buildTxsByAddressFilterFragment(addresses, filters);
  const rows = await db<[{ total: bigint }]>`
    SELECT COUNT(*)::bigint AS total
    FROM core.transactions t
    WHERE t.signers && ${db.array(addresses)}
      ${filterFragment}
  `;
  return rows[0]?.total ?? BigInt(0);
}

export async function queryTxsStats(): Promise<{ total_txs: bigint; last_height: bigint }> {
  const rows = await db<[{ total: bigint | null; last_height: bigint | null }]>`
    SELECT COUNT(*)::bigint AS total, MAX(height) AS last_height FROM core.transactions
  `;
  return {
    total_txs: rows[0]?.total ?? BigInt(0),
    last_height: rows[0]?.last_height ?? BigInt(0),
  };
}

export async function queryTxsTotal(): Promise<bigint> {
  // Sum reltuples across all child partitions — parent always shows 0 for partitioned tables
  const rows = await db<[{ total: bigint }]>`
    SELECT COALESCE(SUM(c.reltuples), 0)::bigint AS total
    FROM pg_class c
    JOIN pg_inherits i ON i.inhrelid = c.oid
    WHERE i.inhparent = 'core.transactions'::regclass
  `;
  return rows[0]?.total ?? BigInt(0);
}

export async function queryTxByHash(hash: string): Promise<TxDetailRow | null> {
  const rows = await db<TxDetailRow[]>`
    SELECT tx_hash, height, tx_index, time, code, gas_wanted, gas_used,
           fee, memo, signers, log_summary
    FROM core.transactions
    WHERE tx_hash = ${hash}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function queryTxMessages(hash: string, height: bigint): Promise<MessageRow[]> {
  return db<MessageRow[]>`
    SELECT msg_index, type_url, value, signer
    FROM core.messages
    WHERE tx_hash = ${hash} AND height = ${height}
    ORDER BY msg_index
  `;
}

export async function queryTxEvents(hash: string, height: bigint): Promise<EventRow[]> {
  return db<EventRow[]>`
    SELECT msg_index, event_index, event_type, attributes
    FROM core.events
    WHERE tx_hash = ${hash} AND height = ${height}
    ORDER BY msg_index, event_index
  `;
}

export async function queryTxRaw(hash: string): Promise<TxRawRow | null> {
  const rows = await db<TxRawRow[]>`
    SELECT raw_tx
    FROM core.transactions
    WHERE tx_hash = ${hash}
    LIMIT 1
  `;
  return rows[0] ?? null;
}
