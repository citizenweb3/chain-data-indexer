import { queryBlockByHeight, queryBlocksList, queryBlocksTotal } from '@/queries/blocks-queries';

export async function listBlocks(params: { limit: number; beforeHeight?: bigint }) {
  const [rows, total] = await Promise.all([queryBlocksList(params), queryBlocksTotal()]);

  const hasMore = rows.length > params.limit;
  const page = hasMore ? rows.slice(0, params.limit) : rows;

  const data = page.map((r) => ({
    block_hash: r.block_hash,
    height: r.height.toString(),
    time: r.time.toISOString(),
    tx_count: r.tx_count,
    proposer_address: r.proposer_address,
  }));

  const last = page.at(-1);
  const cursor = hasMore && last !== undefined ? { next_before_height: last.height.toString() } : null;

  return { data, cursor, has_more: hasMore, total: total.toString() };
}

export async function getBlockByHeight(height: bigint) {
  const row = await queryBlockByHeight(height);
  if (!row) return null;
  return {
    block_hash: row.block_hash,
    height: row.height.toString(),
    time: row.time.toISOString(),
    proposer_address: row.proposer_address,
    tx_count: row.tx_count,
    size_bytes: row.size_bytes,
    last_commit_hash: row.last_commit_hash,
    data_hash: row.data_hash,
    app_hash: row.app_hash,
    evidence_count: row.evidence_count,
  };
}
