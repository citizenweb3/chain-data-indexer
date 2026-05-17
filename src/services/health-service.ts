import { Prisma } from '@prisma/client';

import { db } from '@/db';

export type SyncWatermark = {
  last_synced_at: string | null;
  last_synced_height: string | null;
};

type WatermarkRow = {
  last_height: bigint | null;
  last_time: Date | null;
};

export const getSyncWatermark = async (): Promise<SyncWatermark> => {
  const rows = await db.$queryRaw<WatermarkRow[]>(Prisma.sql`
    SELECT
      MAX(event_height) AS last_height,
      MAX(event_time)   AS last_time
    FROM ibc_packets
  `);
  const w = rows[0];
  return {
    last_synced_at: w?.last_time?.toISOString() ?? null,
    last_synced_height: w?.last_height?.toString() ?? null,
  };
};
