import { Prisma } from '@prisma/client';

import { db } from '@/db';
import { formatNative } from '@/utils/format-amount';

export type TimeseriesMetric = 'transfers' | 'volume_atom' | 'volume_usd';
export type TimeseriesDirection = 'outgoing' | 'incoming' | 'both';

export type TimeseriesPoint = { date: string; value: string };

export type TimeseriesResult = { data: TimeseriesPoint[] };

const MS_PER_HOUR = 3_600_000;
const HOURLY_BUCKETS = 24;

type HourlyRow = { hour: Date; value: Prisma.Decimal | bigint };

const queryHourly = async (params: {
  metric: TimeseriesMetric;
  direction: TimeseriesDirection;
  from: Date;
  channelIdSrc?: string;
}): Promise<HourlyRow[]> => {
  const spotFrom = new Date(params.from.getTime() - 2 * MS_PER_DAY);
  const channelClause =
    params.channelIdSrc !== undefined
      ? Prisma.sql`p.channel_id_src = ${params.channelIdSrc}`
      : Prisma.sql`TRUE`;

  if (params.metric === 'transfers') {
    return db.$queryRaw<HourlyRow[]>(Prisma.sql`
      SELECT date_trunc('hour', p.event_time) AS hour,
             COUNT(*)::bigint AS value
      FROM ibc_packets p
      WHERE p.event_time IS NOT NULL
        AND p.event_time >= ${params.from}
        AND ${channelClause}
        AND ${directionFilter(params.direction)}
      GROUP BY hour
      ORDER BY hour ASC
    `);
  }

  if (params.metric === 'volume_atom') {
    return db.$queryRaw<HourlyRow[]>(Prisma.sql`
      SELECT date_trunc('hour', p.event_time) AS hour,
             COALESCE(SUM(p.amount), 0) AS value
      FROM ibc_packets p
      WHERE p.event_time IS NOT NULL
        AND p.event_time >= ${params.from}
        AND resolve_base_denom(p.denom) = ${ATOM_DENOM}
        AND ${channelClause}
        AND ${directionFilter(params.direction)}
      GROUP BY hour
      ORDER BY hour ASC
    `);
  }

  return db.$queryRaw<HourlyRow[]>(Prisma.sql`
    WITH daily_spot_prices AS (
      SELECT DISTINCT ON (asset_id, date)
        asset_id,
        (created_at AT TIME ZONE 'UTC')::date AS date,
        usd
      FROM prices
      WHERE created_at >= ${spotFrom}
      ORDER BY asset_id, (created_at AT TIME ZONE 'UTC')::date, created_at DESC
    )
    SELECT date_trunc('hour', p.event_time) AS hour,
           COALESCE(
             SUM((p.amount / POWER(10::numeric, a.decimals)) * COALESCE(ph.usd, dsp.usd)),
             0
           ) AS value
    FROM ibc_packets p
    LEFT JOIN assets a ON a.native_denom = resolve_base_denom(p.denom)
    LEFT JOIN price_history ph ON ph.asset_id = a.id
      AND ph.date = (p.event_time AT TIME ZONE 'UTC')::date
    LEFT JOIN daily_spot_prices dsp ON dsp.asset_id = a.id
      AND dsp.date = (p.event_time AT TIME ZONE 'UTC')::date
    WHERE p.event_time IS NOT NULL
      AND p.event_time >= ${params.from}
      AND a.id IS NOT NULL
      AND COALESCE(ph.usd, dsp.usd) IS NOT NULL
      AND ${channelClause}
      AND ${directionFilter(params.direction)}
    GROUP BY hour
    ORDER BY hour ASC
  `);
};

export const getTimeseriesHourly = async (params: {
  metric: TimeseriesMetric;
  direction: TimeseriesDirection;
  channelIdSrc?: string;
}): Promise<TimeseriesResult> => {
  const now = new Date();
  const currentHour = new Date(now);
  currentHour.setUTCMinutes(0, 0, 0);
  const from = new Date(
    currentHour.getTime() - (HOURLY_BUCKETS - 1) * MS_PER_HOUR,
  );

  const rows = await queryHourly({
    metric: params.metric,
    direction: params.direction,
    from,
    channelIdSrc: params.channelIdSrc,
  });

  const byHour = new Map<string, Prisma.Decimal | bigint>();
  for (const row of rows) {
    byHour.set(row.hour.toISOString(), row.value);
  }

  const data: TimeseriesPoint[] = [];
  for (let i = 0; i < HOURLY_BUCKETS; i++) {
    const t = new Date(from.getTime() + i * MS_PER_HOUR);
    const key = t.toISOString();
    const value = byHour.get(key) ?? null;
    data.push({ date: key, value: formatValue(params.metric, value) });
  }

  return { data };
};

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

  const denomFilter =
    params.metric === 'volume_atom'
      ? Prisma.sql`denom = ${ATOM_DENOM}`
      : Prisma.sql`denom IS NOT NULL`;

  return db.$queryRaw<RawRow[]>(Prisma.sql`
    SELECT date, ${valueExpr} AS value
    FROM ibc_daily_stats
    WHERE ${channelClause}
      AND ${denomFilter}
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
        AND resolve_base_denom(p.denom) = ${ATOM_DENOM}
        AND ${channelClause}
        AND ${directionFilter(params.direction)}
    `);
    return rows[0]?.value ?? new Prisma.Decimal(0);
  }

  const spotFrom = new Date(params.midnight.getTime() - MS_PER_DAY);
  const rows = await db.$queryRaw<TodayRow[]>(Prisma.sql`
    WITH daily_spot_prices AS (
      SELECT DISTINCT ON (asset_id, date)
        asset_id,
        (created_at AT TIME ZONE 'UTC')::date AS date,
        usd
      FROM prices
      WHERE created_at >= ${spotFrom}
      ORDER BY asset_id, (created_at AT TIME ZONE 'UTC')::date, created_at DESC
    )
    SELECT COALESCE(
      SUM((p.amount / POWER(10::numeric, a.decimals)) * COALESCE(ph.usd, dsp.usd)),
      0
    ) AS value
    FROM ibc_packets p
    LEFT JOIN assets a ON a.native_denom = resolve_base_denom(p.denom)
    LEFT JOIN price_history ph ON ph.asset_id = a.id
      AND ph.date = (p.event_time AT TIME ZONE 'UTC')::date
    LEFT JOIN daily_spot_prices dsp ON dsp.asset_id = a.id
      AND dsp.date = (p.event_time AT TIME ZONE 'UTC')::date
    WHERE p.event_time IS NOT NULL
      AND p.event_time >= ${params.midnight}
      AND a.id IS NOT NULL
      AND COALESCE(ph.usd, dsp.usd) IS NOT NULL
      AND ${channelClause}
      AND ${directionFilter(params.direction)}
  `);
  return rows[0]?.value ?? new Prisma.Decimal(0);
};

const formatValue = (metric: TimeseriesMetric, value: Prisma.Decimal | bigint | null): string => {
  if (value === null) return '0';
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
