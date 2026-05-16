import { Prisma } from '@prisma/client';

import { db } from '@/db';
import { formatNative } from '@/utils/format-amount';

export type TimeseriesMetric = 'transfers' | 'volume_atom' | 'volume_usd';
export type TimeseriesDirection = 'outgoing' | 'incoming' | 'both';

export type TimeseriesPoint = { date: string; value: string };

export type TimeseriesResult = { data: TimeseriesPoint[] };

const ATOM_DENOM = 'uatom';
const ATOM_DECIMALS = 6;
const MS_PER_DAY = 86_400_000;
const DEFAULT_DAYS = 30;
const MAX_RANGE_DAYS = 365;

const toUtcDate = (d: Date): Date => {
  const out = new Date(d);
  out.setUTCHours(0, 0, 0, 0);
  return out;
};

const formatYmd = (d: Date): string => d.toISOString().slice(0, 10);

const directionFilter = (direction: TimeseriesDirection): Prisma.Sql =>
  direction === 'both'
    ? Prisma.sql`direction IN ('outgoing','incoming')`
    : Prisma.sql`direction = ${direction}`;

type RawRow = { date: Date; value: Prisma.Decimal | bigint };

const queryDailyStats = async (params: {
  metric: TimeseriesMetric;
  direction: TimeseriesDirection;
  from: Date;
  toExclusive: Date;
  channelIdSrc?: string;
}): Promise<RawRow[]> => {
  const channelClause =
    params.channelIdSrc !== undefined
      ? Prisma.sql`channel_id_src = ${params.channelIdSrc}`
      : Prisma.sql`channel_id_src IS NULL`;

  if (params.metric === 'transfers') {
    return db.$queryRaw<RawRow[]>(Prisma.sql`
      SELECT date, COALESCE(SUM(transfers_count), 0)::bigint AS value
      FROM ibc_daily_stats
      WHERE ${channelClause}
        AND denom IS NULL
        AND date >= ${params.from}
        AND date < ${params.toExclusive}
        AND ${directionFilter(params.direction)}
      GROUP BY date
      ORDER BY date ASC
    `);
  }

  const valueExpr =
    params.metric === 'volume_atom'
      ? Prisma.sql`COALESCE(SUM(amount_native), 0)`
      : Prisma.sql`COALESCE(SUM(amount_usd), 0)`;

  return db.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT date, ${valueExpr} AS value
    FROM ibc_daily_stats
    WHERE ${channelClause}
      AND denom = ${ATOM_DENOM}
      AND date >= ${params.from}
      AND date < ${params.toExclusive}
      AND ${directionFilter(params.direction)}
    GROUP BY date
    ORDER BY date ASC
  `);
};

type TodayRow = { value: Prisma.Decimal | bigint };

const queryToday = async (params: {
  metric: TimeseriesMetric;
  direction: TimeseriesDirection;
  midnight: Date;
  channelIdSrc?: string;
}): Promise<Prisma.Decimal | bigint> => {
  const channelClause =
    params.channelIdSrc !== undefined
      ? Prisma.sql`p.channel_id_src = ${params.channelIdSrc}`
      : Prisma.sql`TRUE`;

  if (params.metric === 'transfers') {
    const rows = await db.$queryRaw<TodayRow[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS value
      FROM ibc_packets p
      WHERE p.event_time IS NOT NULL
        AND p.event_time >= ${params.midnight}
        AND ${channelClause}
        AND ${directionFilter(params.direction)}
    `);
    return rows[0]?.value ?? BigInt(0);
  }

  if (params.metric === 'volume_atom') {
    const rows = await db.$queryRaw<TodayRow[]>(Prisma.sql`
      SELECT COALESCE(SUM(p.amount), 0) AS value
      FROM ibc_packets p
      WHERE p.event_time IS NOT NULL
        AND p.event_time >= ${params.midnight}
        AND p.denom = ${ATOM_DENOM}
        AND ${channelClause}
        AND ${directionFilter(params.direction)}
    `);
    return rows[0]?.value ?? new Prisma.Decimal(0);
  }

  const rows = await db.$queryRaw<TodayRow[]>(Prisma.sql`
    SELECT COALESCE(
      SUM((p.amount / POWER(10::numeric, ${ATOM_DECIMALS})) * ph.usd),
      0
    ) AS value
    FROM ibc_packets p
    LEFT JOIN assets a ON a.native_denom = p.denom
    LEFT JOIN price_history ph ON ph.asset_id = a.id
      AND ph.date = (p.event_time AT TIME ZONE 'UTC')::date
    WHERE p.event_time IS NOT NULL
      AND p.event_time >= ${params.midnight}
      AND p.denom = ${ATOM_DENOM}
      AND ph.usd IS NOT NULL
      AND ${channelClause}
      AND ${directionFilter(params.direction)}
  `);
  return rows[0]?.value ?? new Prisma.Decimal(0);
};

const formatValue = (metric: TimeseriesMetric, value: Prisma.Decimal | bigint | null): string => {
  if (value === null) return metric === 'transfers' ? '0' : metric === 'volume_atom' ? '0' : '0';
  if (metric === 'transfers') {
    return typeof value === 'bigint' ? value.toString() : value.toFixed(0);
  }
  if (metric === 'volume_atom') {
    const raw = typeof value === 'bigint' ? value.toString() : value.toFixed(0);
    return formatNative(raw, ATOM_DECIMALS) ?? '0';
  }
  return typeof value === 'bigint' ? value.toString() : value.toFixed(2);
};

export const getTimeseries = async (params: {
  metric: TimeseriesMetric;
  direction: TimeseriesDirection;
  from?: Date;
  to?: Date;
  channelIdSrc?: string;
}): Promise<TimeseriesResult> => {
  const now = new Date();
  const midnight = toUtcDate(now);

  const toBoundary = params.to ? toUtcDate(params.to) : midnight;
  const fromRaw = params.from
    ? toUtcDate(params.from)
    : new Date(toBoundary.getTime() - (DEFAULT_DAYS - 1) * MS_PER_DAY);

  const earliestFrom = new Date(
    toBoundary.getTime() - (MAX_RANGE_DAYS - 1) * MS_PER_DAY,
  );
  const fromBoundary = fromRaw.getTime() < earliestFrom.getTime() ? earliestFrom : fromRaw;

  const toExclusive = new Date(toBoundary.getTime() + MS_PER_DAY);

  const dailyRows = await queryDailyStats({
    metric: params.metric,
    direction: params.direction,
    from: fromBoundary,
    toExclusive,
    channelIdSrc: params.channelIdSrc,
  });

  const byDate = new Map<string, Prisma.Decimal | bigint>();
  for (const row of dailyRows) {
    byDate.set(formatYmd(row.date), row.value);
  }

  const includesToday = toBoundary.getTime() >= midnight.getTime();
  if (includesToday) {
    const todayKey = formatYmd(midnight);
    const todayValue = await queryToday({
      metric: params.metric,
      direction: params.direction,
      midnight,
      channelIdSrc: params.channelIdSrc,
    });
    byDate.set(todayKey, todayValue);
  }

  const data: TimeseriesPoint[] = [];
  for (let t = fromBoundary.getTime(); t <= toBoundary.getTime(); t += MS_PER_DAY) {
    const key = formatYmd(new Date(t));
    const value = byDate.get(key) ?? null;
    data.push({ date: key, value: formatValue(params.metric, value) });
  }

  return { data };
};
