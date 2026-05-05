import { db } from '@/db/indexer-db';

export interface BlockSummaryRow {
  block_hash: string;
  height: bigint;
  time: Date;
  tx_count: number;
  proposer_address: string;
}

export interface BlockDetailRow extends BlockSummaryRow {
  size_bytes: number | null;
  last_commit_hash: string | null;
  data_hash: string | null;
  app_hash: string | null;
  evidence_count: number;
}

export async function queryBlocksList(params: {
  limit: number;
  beforeHeight?: bigint;
}): Promise<BlockSummaryRow[]> {
  const { limit, beforeHeight } = params;
  // fetch limit+1 so the service can detect has_more
  const fetch = limit + 1;

  if (beforeHeight !== undefined) {
    return db<BlockSummaryRow[]>`
      SELECT block_hash, height, time, tx_count, proposer_address
      FROM core.blocks
      WHERE height < ${beforeHeight}
      ORDER BY height DESC
      LIMIT ${fetch}
    `;
  }

  return db<BlockSummaryRow[]>`
    SELECT block_hash, height, time, tx_count, proposer_address
    FROM core.blocks
    ORDER BY height DESC
    LIMIT ${fetch}
  `;
}

export async function queryBlocksTotal(): Promise<bigint> {
  const rows = await db<[{ total: bigint }]>`
    SELECT COALESCE(MAX(height), -1) + 1 AS total FROM core.blocks
  `;
  return rows[0]?.total ?? BigInt(0);
}

export async function queryBlockByHeight(height: bigint): Promise<BlockDetailRow | null> {
  const rows = await db<BlockDetailRow[]>`
    SELECT block_hash, height, time, proposer_address, tx_count,
           size_bytes, last_commit_hash, data_hash, app_hash, evidence_count
    FROM core.blocks
    WHERE height = ${height}
  `;
  return rows[0] ?? null;
}
