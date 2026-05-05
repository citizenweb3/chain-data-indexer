import {
  queryTxByHash,
  queryTxEvents,
  queryTxMessages,
  queryTxRaw,
  queryTxsList,
  queryTxsTotal,
} from '@/queries/txs-queries';

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

export async function listTxs(params: {
  limit: number;
  beforeHeight?: bigint;
  beforeIndex?: number;
}) {
  const [rows, total] = await Promise.all([queryTxsList(params), queryTxsTotal()]);

  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;

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
