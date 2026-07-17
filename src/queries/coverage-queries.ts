import { db } from '@/db/indexer-db';

export interface CoverageRow {
  earliest_height: bigint;
  earliest_time: Date;
}

export const queryCoverage = async (): Promise<CoverageRow | null> => {
  const rows = await db<CoverageRow[]>`
    SELECT height AS earliest_height, time AS earliest_time
    FROM core.blocks
    ORDER BY height ASC
    LIMIT 1
  `;

  return rows[0] ?? null;
};
