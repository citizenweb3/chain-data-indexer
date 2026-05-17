import { Prisma } from '@prisma/client';

import { db } from '@/db';
import { formatNative } from '@/utils/format-amount';

export type StatsDirection = 'outgoing' | 'incoming' | 'both';

export type StatsResult = {
  transfers_count: { '24h': number; '7d': number; '30d': number };
  volume_atom: { '24h': string; '7d': string; '30d': string };
  volume_usd: { '24h': string; '7d': string; '30d': string };
  as_of: string;
};

const ATOM_DENOM = 'uatom';
const ATOM_DECIMALS = 6;
const MS_PER_DAY = 86_400_000;

const todayUtcMidnight = (now: Date): Date => {
  const d = new Date(now);
  d.setUTCHours(0, 0, 0, 0);
  return d;
};

const directionFilter = (direction: StatsDirection): Prisma.Sql =>
  direction === 'both'
    ? Prisma.sql`direction IN ('outgoing','incoming')`
    : Prisma.sql`direction = ${direction}`;

type PacketWindowRow = {
  transfers_count: bigint;
  amount_native: Prisma.Decimal | null;
  amount_usd: Prisma.Decimal | null;
};

const queryPacketsWindow = async (
  direction: StatsDirection,
  fromTime: Date,
): Promise<PacketWindowRow> => {
  const rows = await db.$queryRaw<PacketWindowRow[]>(Prisma.sql`
    WITH daily_spot_prices AS (
      SELECT DISTINCT ON (asset_id, date)
        asset_id,
        (created_at AT TIME ZONE 'UTC')::date AS date,
        usd
      FROM prices
      ORDER BY asset_id, (created_at AT TIME ZONE 'UTC')::date, created_at DESC
    )
    SELECT
      COUNT(*)::bigint AS transfers_count,
      COALESCE(SUM(
        CASE WHEN resolve_base_denom(p.denom) = ${ATOM_DENOM} THEN p.amount END
      ), 0) AS amount_native,
      COALESCE(SUM(
        CASE
          WHEN a.id IS NOT NULL
            AND COALESCE(ph.usd, dsp.usd) IS NOT NULL
          THEN (p.amount / POWER(10::numeric, a.decimals))
            * COALESCE(ph.usd, dsp.usd)
        END
      ), 0) AS amount_usd
    FROM ibc_packets p
    LEFT JOIN assets a ON a.native_denom = resolve_base_denom(p.denom)
    LEFT JOIN price_history ph ON ph.asset_id = a.id
      AND ph.date = (p.event_time AT TIME ZONE 'UTC')::date
    LEFT JOIN daily_spot_prices dsp ON dsp.asset_id = a.id
      AND dsp.date = (p.event_time AT TIME ZONE 'UTC')::date
    WHERE p.event_time IS NOT NULL
      AND p.event_time >= ${fromTime}
      AND ${directionFilter(direction)}
  `);
  return (
    rows[0] ?? {
      transfers_count: BigInt(0),
      amount_native: null,
      amount_usd: null,
    }
  );
};

type DailyWindowRow = {
  transfers_count: bigint;
  amount_native: Prisma.Decimal | null;
  amount_usd: Prisma.Decimal | null;
};

const queryDailyWindow = async (
  direction: StatsDirection,
  fromDate: Date,
  toDateExclusive: Date,
): Promise<DailyWindowRow> => {
  const countRows = await db.$queryRaw<{ transfers_count: bigint }[]>(Prisma.sql`
    SELECT COALESCE(SUM(transfers_count), 0)::bigint AS transfers_count
    FROM ibc_daily_stats
    WHERE channel_id_src IS NULL
      AND denom IS NULL
      AND date >= ${fromDate}
      AND date < ${toDateExclusive}
      AND ${directionFilter(direction)}
  `);

  const volRows = await db.$queryRaw<{
    amount_native: Prisma.Decimal | null;
    amount_usd: Prisma.Decimal | null;
  }[]>(Prisma.sql`
    SELECT
      COALESCE(SUM(amount_native) FILTER (WHERE denom = ${ATOM_DENOM}), 0) AS amount_native,
      COALESCE(SUM(amount_usd) FILTER (WHERE denom IS NOT NULL), 0) AS amount_usd
    FROM ibc_daily_stats
    WHERE channel_id_src IS NULL
      AND denom IS NOT NULL
      AND date >= ${fromDate}
      AND date < ${toDateExclusive}
      AND ${directionFilter(direction)}
  `);

  return {
    transfers_count: countRows[0]?.transfers_count ?? BigInt(0),
    amount_native: volRows[0]?.amount_native ?? null,
    amount_usd: volRows[0]?.amount_usd ?? null,
  };
};

const addDecimal = (
  a: Prisma.Decimal | null,
  b: Prisma.Decimal | null,
): Prisma.Decimal | null => {
  if (a === null && b === null) return null;
  const left = a ?? new Prisma.Decimal(0);
  const right = b ?? new Prisma.Decimal(0);
  return left.add(right);
};

const formatAtom = (value: Prisma.Decimal | null): string =>
  formatNative(value !== null ? value.toFixed(0) : '0', ATOM_DECIMALS) ?? '0';

const formatUsd = (value: Prisma.Decimal | null): string =>
  value === null ? '0' : value.toFixed(2);

export const getStats = async (params: {
  direction: StatsDirection;
}): Promise<StatsResult> => {
  const now = new Date();
  const midnight = todayUtcMidnight(now);

  const window24hStart = new Date(now.getTime() - MS_PER_DAY);
  const window7dDailyFrom = new Date(midnight.getTime() - 6 * MS_PER_DAY);
  const window30dDailyFrom = new Date(midnight.getTime() - 29 * MS_PER_DAY);

  const [w24h, today, daily7d, daily30d] = await Promise.all([
    queryPacketsWindow(params.direction, window24hStart),
    queryPacketsWindow(params.direction, midnight),
    queryDailyWindow(params.direction, window7dDailyFrom, midnight),
    queryDailyWindow(params.direction, window30dDailyFrom, midnight),
  ]);

  const count7d = Number(daily7d.transfers_count) + Number(today.transfers_count);
  const count30d = Number(daily30d.transfers_count) + Number(today.transfers_count);
  const count24h = Number(w24h.transfers_count);

  const atom24h = w24h.amount_native;
  const atom7d = addDecimal(daily7d.amount_native, today.amount_native);
  const atom30d = addDecimal(daily30d.amount_native, today.amount_native);

  const usd24h = w24h.amount_usd;
  const usd7d = addDecimal(daily7d.amount_usd, today.amount_usd);
  const usd30d = addDecimal(daily30d.amount_usd, today.amount_usd);

  return {
    transfers_count: { '24h': count24h, '7d': count7d, '30d': count30d },
    volume_atom: {
      '24h': formatAtom(atom24h),
      '7d': formatAtom(atom7d),
      '30d': formatAtom(atom30d),
    },
    volume_usd: {
      '24h': formatUsd(usd24h),
      '7d': formatUsd(usd7d),
      '30d': formatUsd(usd30d),
    },
    as_of: now.toISOString(),
  };
};
