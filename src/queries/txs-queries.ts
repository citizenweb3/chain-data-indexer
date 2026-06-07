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

// Transactions involving an address (the indexer's `signers` is a grab-bag of actor fields:
// signer/from_address/delegator_address/validator_address/granter/grantee). `@>` uses the GIN
// index idx_txs_signers_gin; `= ANY` would NOT, so keep `@>`. The ::text[] cast is required so
// porsager binds a text array. Two static variants (cursor / no-cursor) — no string concat.
export async function queryTxsByAddress(params: {
  address: string;
  limit: number;
  beforeHeight?: bigint;
  beforeIndex?: number;
}): Promise<TxSummaryRow[]> {
  const { address, limit, beforeHeight, beforeIndex } = params;
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
      WHERE t.signers @> ARRAY[${address}]::text[]
        AND (t.height, t.tx_index) < (${beforeHeight}, ${beforeIndex})
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
    WHERE t.signers @> ARRAY[${address}]::text[]
    ORDER BY t.height DESC, t.tx_index DESC
    LIMIT ${fetch}
  `;
}

// Exact per-address total. A single address's involved-tx set is narrow (the GIN bitmap returns
// few rows), so this COUNT is cheap — unlike the global table count (which uses the reltuples
// estimate in queryTxsTotal). Always returns a number; serialized as a string by the service.
export async function queryTxsByAddressTotal(address: string): Promise<bigint> {
  const rows = await db<[{ total: bigint }]>`
    SELECT COUNT(*)::bigint AS total
    FROM core.transactions
    WHERE signers @> ARRAY[${address}]::text[]
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
