import {
  queryTxByHash,
  queryTxEvents,
  queryTxMessages,
  queryTxRaw,
  queryTxsByAddress,
  queryTxsByAddressTotal,
  queryTxsList,
  queryTxsStats,
  queryTxsTotal,
  type TxSummaryRow,
} from '@/queries/txs-queries';

const TXS_STATS_TTL_MS = 60_000;
let txsStatsCache: { value: { total_txs: string; last_height: string }; expiresAt: number } | null = null;
let txsStatsInflight: Promise<{ total_txs: string; last_height: string }> | null = null;

export async function getTxsStats() {
  const now = Date.now();
  if (txsStatsCache && txsStatsCache.expiresAt > now) return txsStatsCache.value;
  if (txsStatsInflight) return txsStatsInflight;

  txsStatsInflight = (async () => {
    const stats = await queryTxsStats();
    const value = {
      total_txs: stats.total_txs.toString(),
      last_height: stats.last_height.toString(),
    };
    txsStatsCache = { value, expiresAt: Date.now() + TXS_STATS_TTL_MS };
    return value;
  })().finally(() => {
    txsStatsInflight = null;
  });

  return txsStatsInflight;
}

interface Fee {
  amount: { amount: string; denom: string }[];
  gas_limit: string;
  payer: string;
  granter: string;
}

function parseFee(raw: unknown): Fee | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Record<string, unknown>;
  return {
    amount: Array.isArray(f['amount']) ? (f['amount'] as { amount: string; denom: string }[]) : [],
    gas_limit: String(f['gas_limit'] ?? '0'),
    payer: String(f['payer'] ?? ''),
    granter: String(f['granter'] ?? ''),
  };
}

// Shared list-envelope builder: strip the limit+1 probe row, map BigInt→string, build the
// keyset cursor from the last page row. `total` is always a decimal string.
function buildTxsResult(rows: TxSummaryRow[], limit: number, total: bigint) {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const data = page.map((r) => ({
    tx_hash: r.tx_hash,
    height: r.height.toString(),
    tx_index: r.tx_index,
    time: r.time.toISOString(),
    code: r.code,
    first_msg_type: r.first_msg_type,
    fee: { amount: r.fee_amount, denom: r.fee_denom },
  }));

  const last = page.at(-1);
  const cursor =
    hasMore && last !== undefined
      ? { next_before_height: last.height.toString(), next_before_index: last.tx_index }
      : null;

  return { data, cursor, has_more: hasMore, total: total.toString() };
}

export async function listTxs(params: {
  limit: number;
  beforeHeight?: bigint;
  beforeIndex?: number;
}) {
  const [rows, total] = await Promise.all([queryTxsList(params), queryTxsTotal()]);
  return buildTxsResult(rows, params.limit, total);
}

// Transactions involving one or more addresses. Same envelope as listTxs, but the total is an
// exact COUNT over the address set (cheap, narrow GIN set) rather than the global reltuples estimate.
export async function listTxsByAddress(params: {
  addresses: string[];
  limit: number;
  beforeHeight?: bigint;
  beforeIndex?: number;
}) {
  const [rows, total] = await Promise.all([
    queryTxsByAddress(params),
    queryTxsByAddressTotal(params.addresses),
  ]);
  return buildTxsResult(rows, params.limit, total);
}

export async function getTxDetail(hash: string) {
  const tx = await queryTxByHash(hash);
  if (!tx) return null;

  const [messages, events] = await Promise.all([queryTxMessages(hash, tx.height), queryTxEvents(hash, tx.height)]);

  return {
    tx_hash: tx.tx_hash,
    height: tx.height.toString(),
    tx_index: tx.tx_index,
    time: tx.time.toISOString(),
    code: tx.code,
    gas_wanted: tx.gas_wanted !== null ? tx.gas_wanted.toString() : null,
    gas_used: tx.gas_used !== null ? tx.gas_used.toString() : null,
    fee: parseFee(tx.fee),
    memo: tx.memo,
    signers: tx.signers,
    log_summary: tx.log_summary,
    messages,
    events,
  };
}

export async function getTxRaw(hash: string) {
  const row = await queryTxRaw(hash);
  if (!row) return null;
  return { raw_tx: row.raw_tx };
}
