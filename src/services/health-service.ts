import { Prisma } from '@prisma/client';

import { db } from '@/db';
import { CHAIN_NAMES, type ChainName } from '@/lib/chains';

export type ChainSyncWatermark = {
  chain: ChainName;
  last_synced_at: string | null;
  last_synced_height: string | null;
};

type WatermarkRow = {
  chain: string;
  last_height: bigint | null;
  last_time: Date | null;
};

export const getSyncWatermarks = async (): Promise<ChainSyncWatermark[]> => {
  const rows = await db.$queryRaw<WatermarkRow[]>(Prisma.sql`
    SELECT
      chain,
      MAX(event_height) AS last_height,
      MAX(event_time)   AS last_time
    FROM ibc_packets
    GROUP BY chain
  `);

  const byChain = new Map<string, WatermarkRow>();
  for (const r of rows) byChain.set(r.chain, r);

  return CHAIN_NAMES.map((name) => {
    const w = byChain.get(name);
    return {
      chain: name,
      last_synced_at: w?.last_time?.toISOString() ?? null,
      last_synced_height: w?.last_height?.toString() ?? null,
    };
  });
};

