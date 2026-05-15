import { Prisma } from '@prisma/client';

import { db } from '@/db';
import logger from '@/logger';

const log = logger('recompute-daily-stats');

const RECOMPUTE_DAYS = 3;

export const runRecomputeDailyStats = async (): Promise<void> => {
  const startedAt = Date.now();
  log.logInfo('recompute-daily-stats started', { days: RECOMPUTE_DAYS });

  const rowsAffected = await db.$executeRaw(Prisma.sql`
    WITH base AS (
      SELECT
        (p.event_time AT TIME ZONE 'UTC')::date AS date,
        p.channel_id_src,
        p.direction,
        p.denom,
        p.amount
      FROM ibc_packets p
      WHERE p.event_time IS NOT NULL
        AND p.event_time >= (NOW() - make_interval(days => ${RECOMPUTE_DAYS}))
    ),
    agg AS (
      SELECT
        b.date AS date,
        b.channel_id_src AS channel_id_src,
        b.direction AS direction,
        b.denom AS denom,
        COUNT(*)::bigint AS transfers_count,
        CASE WHEN GROUPING(b.denom) = 0 THEN SUM(b.amount) ELSE NULL END AS amount_native,
        CASE
          WHEN GROUPING(b.denom) = 0 AND b.denom = 'uatom' THEN
            SUM(b.amount / POWER(10::numeric, a.decimals) * ph.usd)
          ELSE NULL
        END AS amount_usd
      FROM base b
      LEFT JOIN assets a ON a.native_denom = b.denom
      LEFT JOIN price_history ph ON ph.asset_id = a.id AND ph.date = b.date
      GROUP BY GROUPING SETS (
        (b.date, b.channel_id_src, b.direction, b.denom),
        (b.date, b.channel_id_src, b.direction),
        (b.date, b.direction, b.denom),
        (b.date, b.direction)
      )
    )
    INSERT INTO ibc_daily_stats (
      date, channel_id_src, direction, denom,
      transfers_count, amount_native, amount_usd, recomputed_at
    )
    SELECT
      date, channel_id_src, direction, denom,
      transfers_count, amount_native, amount_usd, NOW()
    FROM agg
    ON CONFLICT (date, channel_id_src, direction, denom)
    DO UPDATE SET
      transfers_count = EXCLUDED.transfers_count,
      amount_native   = EXCLUDED.amount_native,
      amount_usd      = EXCLUDED.amount_usd,
      recomputed_at   = EXCLUDED.recomputed_at
  `);

  const elapsedMs = Date.now() - startedAt;
  log.logInfo('recompute-daily-stats finished', { rowsAffected, elapsedMs });
};
