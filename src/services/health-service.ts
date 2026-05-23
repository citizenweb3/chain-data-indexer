import { Prisma } from '@prisma/client';

import { db } from '@/db';
import { CHAIN_NAMES, type ChainName } from '@/lib/chains';

export type ChainSyncWatermark = {
  chain: ChainName;
  last_synced_at: string | null;
  last_synced_height: string | null;
  last_sync_attempt_at: string | null;
};

type PacketRow = {
  chain: string;
  last_height: bigint | null;
  last_time: Date | null;
};

type CursorRow = {
  chain: string;
  last_attempt: Date | null;
};

export const getSyncWatermarks = async (): Promise<ChainSyncWatermark[]> => {
  const [packetRows, cursorRows] = await Promise.all([
    db.$queryRaw<PacketRow[]>(Prisma.sql`
      SELECT
        chain,
        MAX(event_height) AS last_height,
        MAX(event_time)   AS last_time
      FROM ibc_packets
      GROUP BY chain
    `),
    db.$queryRaw<CursorRow[]>(Prisma.sql`
      SELECT
        chain,
        MAX(updated_at) AS last_attempt
      FROM sync_cursors
      GROUP BY chain
    `),
  ]);

  const packetByChain = new Map<string, PacketRow>();
  for (const r of packetRows) packetByChain.set(r.chain, r);
  const cursorByChain = new Map<string, CursorRow>();
  for (const r of cursorRows) cursorByChain.set(r.chain, r);

  return CHAIN_NAMES.map((name) => {
    const pkt = packetByChain.get(name);
    const cur = cursorByChain.get(name);
    return {
      chain: name,
      last_synced_at: pkt?.last_time?.toISOString() ?? null,
      last_synced_height: pkt?.last_height?.toString() ?? null,
      last_sync_attempt_at: cur?.last_attempt?.toISOString() ?? null,
    };
  });
};

