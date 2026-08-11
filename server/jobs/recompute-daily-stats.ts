import { Prisma } from '@prisma/client';

import { db } from '@/db';
import logger from '@/logger';
import {
  DELIVERED_PACKET_SQL,
  PRICED_PACKET_SQL,
  RESOLVED_PACKET_DENOM_SQL,
} from '@/services/ibc-aggregation-sql';

const log = logger('recompute-daily-stats');

const RECOMPUTE_DAYS = 3;
const HEARTBEAT_KEY = 'recompute-daily-stats';
const AGGREGATE_VERSION = 2;
const TRANSACTION_TIMEOUT_MS = 180_000;

type RecomputeMode = 'bootstrap' | 'incremental' | 'noop';

type AggregateState = {
  version: number;
  correctedFrom: Date | null;
};

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

const readAggregateState = async (chain: string): Promise<AggregateState | null> =>
  db.ibcAggregateState.findUnique({
    where: { chain },
    select: { version: true, correctedFrom: true },
  });

const resolveRecomputeFromDate = async (
  chain: string,
): Promise<{
  fromDate: Date | null;
  mode: RecomputeMode;
  state: AggregateState | null;
}> => {
  const today = todayUtcMidnight();
  const incrementalFrom = new Date(today);
  incrementalFrom.setUTCDate(incrementalFrom.getUTCDate() - (RECOMPUTE_DAYS - 1));

  const earliestPacket = await readEarliestPacketDate(chain);
  const state = await readAggregateState(chain);
  if (earliestPacket === null) {
    return { fromDate: null, mode: 'noop', state };
  }

  const needsBootstrap =
    state === null ||
    state.version !== AGGREGATE_VERSION ||
    state.correctedFrom === null ||
    earliestPacket.getTime() < state.correctedFrom.getTime();
  if (needsBootstrap) {
    return { fromDate: earliestPacket, mode: 'bootstrap', state };
  }
  return { fromDate: incrementalFrom, mode: 'incremental', state };
};

const writeHeartbeat = async (
  tx: Prisma.TransactionClient,
  chain: string,
  recomputedAt: Date,
): Promise<void> => {
  await tx.syncCursor.upsert({
    where: { chain_key: { chain, key: HEARTBEAT_KEY } },
    create: { chain, key: HEARTBEAT_KEY, updatedAt: recomputedAt },
    update: { updatedAt: recomputedAt },
  });
};

const recordEmptyRecompute = async (
  chain: string,
  state: AggregateState | null,
  recomputedAt: Date,
): Promise<void> => {
  await db.$transaction(
    async (tx) => {
      await tx.ibcAggregateState.upsert({
        where: { chain },
        create: {
          chain,
          version: state?.version ?? 0,
          correctedFrom: state?.correctedFrom ?? null,
          lastRecomputedAt: recomputedAt,
          updatedAt: recomputedAt,
        },
        update: { lastRecomputedAt: recomputedAt, updatedAt: recomputedAt },
      });
      await writeHeartbeat(tx, chain, recomputedAt);
    },
    { timeout: TRANSACTION_TIMEOUT_MS },
  );
};

const recomputeOneChain = async (chain: string): Promise<void> => {
  const startedAt = Date.now();
  const { fromDate, mode, state } = await resolveRecomputeFromDate(chain);
  log.logInfo(`[${chain}] recompute-daily-stats started`, {
    mode,
    fromDate: fromDate?.toISOString() ?? null,
  });

  if (fromDate === null) {
    await recordEmptyRecompute(chain, state, new Date());
    log.logInfo(`[${chain}] recompute-daily-stats noop: no packets to aggregate`);
    return;
  }

  try {
    const recomputedAt = new Date();
    const previousCorrectedFrom = state?.correctedFrom ?? null;
    const correctedFrom =
      previousCorrectedFrom === null ||
      (mode === 'bootstrap' && fromDate.getTime() < previousCorrectedFrom.getTime())
        ? fromDate
        : previousCorrectedFrom;

    const { deletedRows, insertedRows } = await db.$transaction(
      async (tx) => {
        const deletedRows = await tx.$executeRaw(Prisma.sql`
          DELETE FROM ibc_daily_stats
          WHERE chain = ${chain}
            AND date >= ${fromDate}
        `);

        const insertedRows = await tx.$executeRaw(Prisma.sql`
          WITH daily_spot_prices AS (
            SELECT DISTINCT ON (asset_id, date)
              asset_id,
              (created_at AT TIME ZONE 'UTC')::date AS date,
              usd
            FROM prices
            ORDER BY asset_id, (created_at AT TIME ZONE 'UTC')::date, created_at DESC
          ),
          base AS (
            SELECT
              p.chain AS chain,
              (p.event_time AT TIME ZONE 'UTC')::date AS date,
              p.channel_id_src,
              p.direction,
              ${RESOLVED_PACKET_DENOM_SQL} AS denom,
              p.amount,
              a.decimals,
              COALESCE(ph.usd, dsp.usd) AS usd,
              ${PRICED_PACKET_SQL} AS is_priced
            FROM ibc_packets p
            LEFT JOIN assets a
              ON a.native_denom = ${RESOLVED_PACKET_DENOM_SQL}
            LEFT JOIN price_history ph
              ON ph.asset_id = a.id
             AND ph.date = (p.event_time AT TIME ZONE 'UTC')::date
            LEFT JOIN daily_spot_prices dsp
              ON dsp.asset_id = a.id
             AND dsp.date = (p.event_time AT TIME ZONE 'UTC')::date
            WHERE p.event_time IS NOT NULL
              AND p.event_time >= ${fromDate}
              AND p.chain = ${chain}
              AND ${DELIVERED_PACKET_SQL}
          ),
          agg AS (
            SELECT
              b.chain AS chain,
              b.date AS date,
              b.channel_id_src AS channel_id_src,
              b.direction AS direction,
              b.denom AS denom,
              COUNT(*)::bigint AS transfers_count,
              CASE
                WHEN GROUPING(b.denom) = 0 THEN SUM(b.amount)
                ELSE NULL
              END AS amount_native,
              CASE
                WHEN GROUPING(b.denom) = 0 THEN COALESCE(
                  SUM(
                    CASE WHEN b.is_priced
                      THEN b.amount / POWER(10::numeric, b.decimals) * b.usd
                      ELSE 0::numeric
                    END
                  ),
                  0::numeric
                )
                ELSE NULL
              END AS amount_usd,
              COUNT(*)::bigint AS eligible_packets,
              COUNT(*) FILTER (WHERE b.is_priced)::bigint AS priced_packets,
              COUNT(*) FILTER (WHERE NOT b.is_priced)::bigint AS unpriced_packets,
              COALESCE(
                ARRAY_AGG(DISTINCT b.denom ORDER BY b.denom)
                  FILTER (WHERE NOT b.is_priced),
                ARRAY[]::text[]
              ) AS unpriced_denoms
            FROM base b
            GROUP BY GROUPING SETS (
              (b.chain, b.date, b.channel_id_src, b.direction, b.denom),
              (b.chain, b.date, b.channel_id_src, b.direction),
              (b.chain, b.date, b.direction, b.denom),
              (b.chain, b.date, b.direction)
            )
          )
          INSERT INTO ibc_daily_stats (
            chain, date, channel_id_src, direction, denom,
            transfers_count, amount_native, amount_usd,
            eligible_packets, priced_packets, unpriced_packets,
            unpriced_denoms, recomputed_at
          )
          SELECT
            chain, date, channel_id_src, direction, denom,
            transfers_count, amount_native, amount_usd,
            eligible_packets, priced_packets, unpriced_packets,
            unpriced_denoms, ${recomputedAt}
          FROM agg
        `);

        await tx.ibcAggregateState.upsert({
          where: { chain },
          create: {
            chain,
            version: AGGREGATE_VERSION,
            correctedFrom,
            lastRecomputedAt: recomputedAt,
            updatedAt: recomputedAt,
          },
          update: {
            version: AGGREGATE_VERSION,
            correctedFrom,
            lastRecomputedAt: recomputedAt,
            updatedAt: recomputedAt,
          },
        });
        await writeHeartbeat(tx, chain, recomputedAt);
        return { deletedRows, insertedRows };
      },
      { timeout: TRANSACTION_TIMEOUT_MS },
    );

    const elapsedMs = Date.now() - startedAt;
    log.logInfo(`[${chain}] recompute-daily-stats finished`, {
      mode,
      correctedFrom: correctedFrom.toISOString(),
      deletedRows,
      insertedRows,
      elapsedMs,
    });
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
