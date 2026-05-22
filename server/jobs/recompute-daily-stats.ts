import { Prisma } from '@prisma/client';

import { db } from '@/db';
import logger from '@/logger';

const log = logger('recompute-daily-stats');

const RECOMPUTE_DAYS = 3;
const HEARTBEAT_KEY = 'recompute-daily-stats';

type RecomputeMode = 'bootstrap' | 'incremental' | 'noop';

const todayUtcMidnight = (): Date => {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const readEarliestPacketDate = async (chain: string): Promise<Date | null> => {
  const rows = await db.$queryRaw<{ d: Date | null }[]>(Prisma.sql`
    SELECT MIN((event_time AT TIME ZONE 'UTC')::date) AS d
    FROM ibc_packets
    WHERE event_time IS NOT NULL
      AND chain = ${chain}
  `);
  return rows[0]?.d ?? null;
};

const readEarliestDailyDate = async (chain: string): Promise<Date | null> => {
  const rows = await db.$queryRaw<{ d: Date | null }[]>(Prisma.sql`
    SELECT MIN(date) AS d FROM ibc_daily_stats
    WHERE chain = ${chain}
  `);
  return rows[0]?.d ?? null;
};

const resolveRecomputeFromDate = async (
  chain: string,
): Promise<{ fromDate: Date | null; mode: RecomputeMode }> => {
  const today = todayUtcMidnight();
  const incrementalFrom = new Date(today);
  incrementalFrom.setUTCDate(incrementalFrom.getUTCDate() - (RECOMPUTE_DAYS - 1));

  const earliestPacket = await readEarliestPacketDate(chain);
  if (earliestPacket === null) {
    return { fromDate: null, mode: 'noop' };
  }

  const earliestDaily = await readEarliestDailyDate(chain);
  const dailyCoversPacketSpan =
    earliestDaily !== null && earliestDaily.getTime() <= earliestPacket.getTime();

  if (!dailyCoversPacketSpan) {
    return { fromDate: earliestPacket, mode: 'bootstrap' };
  }
  return { fromDate: incrementalFrom, mode: 'incremental' };
};

const recomputeOneChain = async (chain: string): Promise<void> => {
  const startedAt = Date.now();
  const { fromDate, mode } = await resolveRecomputeFromDate(chain);
  log.logInfo(`[${chain}] recompute-daily-stats started`, {
    mode,
    fromDate: fromDate?.toISOString() ?? null,
  });

  if (fromDate === null) {
    log.logInfo(`[${chain}] recompute-daily-stats noop: no packets to aggregate`);
    return;
  }

  try {
    const rowsAffected = await db.$executeRaw(Prisma.sql`
      WITH base AS (
        SELECT
          p.chain AS chain,
          (p.event_time AT TIME ZONE 'UTC')::date AS date,
          p.channel_id_src,
          p.direction,
          resolve_base_denom(p.denom) AS denom,
          p.amount
        FROM ibc_packets p
        WHERE p.event_time IS NOT NULL
          AND p.event_time >= ${fromDate}
          AND p.chain = ${chain}
      ),
      daily_spot_prices AS (
        SELECT DISTINCT ON (asset_id, date)
          asset_id,
          (created_at AT TIME ZONE 'UTC')::date AS date,
          usd
        FROM prices
        ORDER BY asset_id, (created_at AT TIME ZONE 'UTC')::date, created_at DESC
      ),
      agg AS (
        SELECT
          b.chain AS chain,
          b.date AS date,
          b.channel_id_src AS channel_id_src,
          b.direction AS direction,
          b.denom AS denom,
          COUNT(*)::bigint AS transfers_count,
          CASE WHEN GROUPING(b.denom) = 0 THEN SUM(b.amount) ELSE NULL END AS amount_native,
          CASE
            WHEN GROUPING(b.denom) = 0 THEN
              SUM(b.amount / POWER(10::numeric, a.decimals) * COALESCE(ph.usd, dsp.usd))
            ELSE NULL
          END AS amount_usd
        FROM base b
        LEFT JOIN assets a ON a.native_denom = b.denom
        LEFT JOIN price_history ph ON ph.asset_id = a.id AND ph.date = b.date
        LEFT JOIN daily_spot_prices dsp ON dsp.asset_id = a.id AND dsp.date = b.date
        GROUP BY GROUPING SETS (
          (b.chain, b.date, b.channel_id_src, b.direction, b.denom),
          (b.chain, b.date, b.channel_id_src, b.direction),
          (b.chain, b.date, b.direction, b.denom),
          (b.chain, b.date, b.direction)
        )
      )
      INSERT INTO ibc_daily_stats (
        chain, date, channel_id_src, direction, denom,
        transfers_count, amount_native, amount_usd, recomputed_at
      )
      SELECT
        chain, date, channel_id_src, direction, denom,
        transfers_count, amount_native, amount_usd, NOW()
      FROM agg
      ON CONFLICT (chain, date, channel_id_src, direction, denom)
      DO UPDATE SET
        transfers_count = EXCLUDED.transfers_count,
        amount_native   = EXCLUDED.amount_native,
        amount_usd      = EXCLUDED.amount_usd,
        recomputed_at   = EXCLUDED.recomputed_at
    `);

    await db.syncCursor.upsert({
      where: { chain_key: { chain, key: HEARTBEAT_KEY } },
      create: { chain, key: HEARTBEAT_KEY },
      update: {},
    });

    const elapsedMs = Date.now() - startedAt;
    log.logInfo(`[${chain}] recompute-daily-stats finished`, { mode, rowsAffected, elapsedMs });
  } catch (e) {
    const elapsedMs = Date.now() - startedAt;
    log.logError(`[${chain}] recompute-daily-stats failed`, e);
    log.logInfo(`[${chain}] recompute-daily-stats aborted`, { elapsedMs });
    throw e;
  }
};

export const runRecomputeDailyStats = async (chains: string[]): Promise<void> => {
  await Promise.allSettled(
    chains.map(async (chain) => {
      try {
        await recomputeOneChain(chain);
      } catch (err) {
        log.logError(`[${chain}] recompute-daily-stats failed`, err);
      }
    }),
  );
};
