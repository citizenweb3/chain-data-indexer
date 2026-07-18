import { db } from '@/db/indexer-db';
import { TEXT_ARRAY_OID } from '@/db/postgres-types';

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
  msg_types: string[];
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
            AND m2.type_url = ANY(${db.array(filters.msgTypes, TEXT_ARRAY_OID)})
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
            AND (
              bf.from_addr = ANY(${db.array(addresses, TEXT_ARRAY_OID)})
              OR bf.to_addr = ANY(${db.array(addresses, TEXT_ARRAY_OID)})
            )
            AND bf.denom = ${filters.amountDenom}
            ${filters.minAmount !== undefined ? db`AND bf.amount >= ${filters.minAmount}` : db``}
            ${filters.maxAmount !== undefined ? db`AND bf.amount <= ${filters.maxAmount}` : db``}
        )`
      : db``
  }
`;

// Transactions involving one or more addresses. Candidate branches stay index-driven: actors use
// idx_txs_signers_gin while outgoing/incoming transfers use idx_transfers_from/idx_transfers_to.
// Every branch applies the same filters and cursor before its bounded top-N probe; transfer
// branches dedupe transaction keys before LIMIT so repeated transfers cannot consume the window.
// The LATERAL projection returns only address-relevant transfers and applies a total order before
// the five-row summary cap.
export async function queryTxsByAddress(params: TxsByAddressQueryParams): Promise<TxByAddressSummaryRow[]> {
  const { addresses, limit, beforeHeight, beforeIndex, ...filters } = params;
  const fetch = limit + 1;
  const cursorFragment =
    beforeHeight !== undefined && beforeIndex !== undefined
      ? db`AND (t.height, t.tx_index) < (${beforeHeight}, ${beforeIndex})`
      : db``;
  const filterFragment = buildTxsByAddressFilterFragment(addresses, filters);

  return db<TxByAddressSummaryRow[]>`
    WITH candidates AS (
      (
        SELECT t.height, t.tx_hash, t.tx_index
        FROM core.transactions t
        WHERE t.signers && ${db.array(addresses, TEXT_ARRAY_OID)}
          ${filterFragment}
          ${cursorFragment}
        ORDER BY t.height DESC, t.tx_index DESC
        LIMIT ${fetch}
      )
      UNION
      (
        SELECT DISTINCT t.height, t.tx_hash, t.tx_index
        FROM bank.transfers candidate_transfer
        JOIN core.transactions t
          ON t.height = candidate_transfer.height AND t.tx_hash = candidate_transfer.tx_hash
        WHERE candidate_transfer.from_addr = ANY(${db.array(addresses, TEXT_ARRAY_OID)})
          ${filterFragment}
          ${cursorFragment}
        ORDER BY t.height DESC, t.tx_index DESC
        LIMIT ${fetch}
      )
      UNION
      (
        SELECT DISTINCT t.height, t.tx_hash, t.tx_index
        FROM bank.transfers candidate_transfer
        JOIN core.transactions t
          ON t.height = candidate_transfer.height AND t.tx_hash = candidate_transfer.tx_hash
        WHERE candidate_transfer.to_addr = ANY(${db.array(addresses, TEXT_ARRAY_OID)})
          ${filterFragment}
          ${cursorFragment}
        ORDER BY t.height DESC, t.tx_index DESC
        LIMIT ${fetch}
      )
    ),
    page_candidates AS (
      SELECT height, tx_hash, tx_index
      FROM candidates
      ORDER BY height DESC, tx_index DESC
      LIMIT ${fetch}
    )
    SELECT
      t.tx_hash,
      t.height,
      t.tx_index,
      t.time,
      t.code,
      t.fee->'amount'->0->>'amount' AS fee_amount,
      t.fee->'amount'->0->>'denom'  AS fee_denom,
      m.type_url AS first_msg_type,
      COALESCE((
        SELECT array_agg(DISTINCT message.type_url ORDER BY message.type_url)
        FROM core.messages message
        WHERE message.height = t.height
          AND message.tx_hash = t.tx_hash
      ), ARRAY[]::text[]) AS msg_types,
      COALESCE(tr.transfers, '[]'::jsonb) AS transfers
    FROM page_candidates candidate
    JOIN core.transactions t
      ON t.height = candidate.height AND t.tx_hash = candidate.tx_hash
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
          AND (
            b.from_addr = ANY(${db.array(addresses, TEXT_ARRAY_OID)})
            OR b.to_addr = ANY(${db.array(addresses, TEXT_ARRAY_OID)})
          )
        ORDER BY b.msg_index, b.from_addr, b.to_addr, b.denom
        LIMIT 5
      ) transfer_row
    ) tr ON true
    ORDER BY t.height DESC, t.tx_index DESC
  `;
}

// Exact total over the same unbounded, filtered union used by the page query. UNION deduplicates a
// transaction that matches several addresses or actor/from/to branches, keeping count/list parity.
export async function queryTxsByAddressTotal(
  params: Pick<TxsByAddressQueryParams, 'addresses'> & TxsByAddressFilters,
): Promise<bigint> {
  const { addresses, ...filters } = params;
  const filterFragment = buildTxsByAddressFilterFragment(addresses, filters);
  const rows = await db<[{ total: bigint }]>`
    WITH candidates AS (
      SELECT t.height, t.tx_hash
      FROM core.transactions t
      WHERE t.signers && ${db.array(addresses, TEXT_ARRAY_OID)}
        ${filterFragment}
      UNION
      SELECT t.height, t.tx_hash
      FROM bank.transfers candidate_transfer
      JOIN core.transactions t
        ON t.height = candidate_transfer.height AND t.tx_hash = candidate_transfer.tx_hash
      WHERE candidate_transfer.from_addr = ANY(${db.array(addresses, TEXT_ARRAY_OID)})
        ${filterFragment}
      UNION
      SELECT t.height, t.tx_hash
      FROM bank.transfers candidate_transfer
      JOIN core.transactions t
        ON t.height = candidate_transfer.height AND t.tx_hash = candidate_transfer.tx_hash
      WHERE candidate_transfer.to_addr = ANY(${db.array(addresses, TEXT_ARRAY_OID)})
        ${filterFragment}
    )
    SELECT COUNT(*)::bigint AS total
    FROM candidates
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
