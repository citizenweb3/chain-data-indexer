import { Prisma } from '@prisma/client';

import { db } from '@/db';
import { getChainMetadata, type ChainName } from '@/lib/chains';
import type { IbcAggregationFreshness, IbcCoverageStatus } from '@/schemas/ibc-aggregation';
import {
  mergeIbcCoverageRows,
  toIbcCoverageStatus,
  type IbcCoverageCountRow,
} from '@/services/ibc-aggregation-coverage';
import {
  dailyCoverageSelectSql,
  DELIVERED_PACKET_SQL,
  PACKET_COVERAGE_SELECT_SQL,
  PRICED_PACKET_SQL,
  RESOLVED_PACKET_DENOM_SQL,
} from '@/services/ibc-aggregation-sql';
import { classifyIbcDailyRange, getIbcAggregationContext } from '@/services/ibc-aggregation-state';
import { formatNative } from '@/utils/format-amount';

export type TimeseriesMetric = 'transfers' | 'volume_atom' | 'volume_native' | 'volume_usd';
export type TimeseriesDirection = 'outgoing' | 'incoming' | 'both';

export type TimeseriesPoint = IbcCoverageStatus & {
  date: string;
  value: string;
};

export type TimeseriesResult = IbcAggregationFreshness & {
  data: TimeseriesPoint[];
};

const ATOM_METADATA = getChainMetadata('cosmoshub');
const MS_PER_HOUR = 3_600_000;
const MS_PER_DAY = 86_400_000;
const HOURLY_BUCKETS = 24;
const DEFAULT_DAYS = 30;
const MAX_RANGE_DAYS = 365;

const toUtcDate = (date: Date): Date => {
  const result = new Date(date);
  result.setUTCHours(0, 0, 0, 0);
  return result;
};

const formatYmd = (date: Date): string => date.toISOString().slice(0, 10);

const packetDirectionFilter = (direction: TimeseriesDirection): Prisma.Sql =>
  direction === 'both'
    ? Prisma.sql`p.direction IN ('outgoing','incoming')`
    : Prisma.sql`p.direction = ${direction}`;

const dailyDirectionFilter = (direction: TimeseriesDirection): Prisma.Sql =>
  direction === 'both'
    ? Prisma.sql`d.direction IN ('outgoing','incoming')`
    : Prisma.sql`d.direction = ${direction}`;

const packetMetricValue = (metric: TimeseriesMetric, nativeDenom: string): Prisma.Sql => {
  if (metric === 'transfers') return Prisma.sql`COUNT(*)::bigint`;
  if (metric === 'volume_usd') {
    return Prisma.sql`
      COALESCE(SUM(
        CASE WHEN ${PRICED_PACKET_SQL}
          THEN (p.amount / POWER(10::numeric, a.decimals)) * COALESCE(ph.usd, dsp.usd)
        END
      ), 0)
    `;
  }
  const denom = metric === 'volume_atom' ? ATOM_METADATA.nativeDenom : nativeDenom;
  return Prisma.sql`
    COALESCE(SUM(
      CASE WHEN ${RESOLVED_PACKET_DENOM_SQL} = ${denom} THEN p.amount END
    ), 0)
  `;
};

type RawTimeseriesRow = IbcCoverageCountRow & {
  bucket: Date;
  value: Prisma.Decimal | bigint;
};

const queryPacketBuckets = async (params: {
  bucket: 'hour' | 'day';
  metric: TimeseriesMetric;
  direction: TimeseriesDirection;
  from: Date;
  channelIdSrc?: string;
  chain: ChainName | null;
  nativeDenom: string;
}): Promise<RawTimeseriesRow[]> => {
  const bucketSql =
    params.bucket === 'hour'
      ? Prisma.sql`date_trunc('hour', p.event_time)`
      : Prisma.sql`date_trunc('day', p.event_time)`;
  const channelClause =
    params.channelIdSrc === undefined
      ? Prisma.sql`TRUE`
      : Prisma.sql`p.channel_id_src = ${params.channelIdSrc}`;
  const chainClause = params.chain ? Prisma.sql`AND p.chain = ${params.chain}` : Prisma.empty;
  const spotFrom = new Date(params.from.getTime() - 2 * MS_PER_DAY);

  return db.$queryRaw<RawTimeseriesRow[]>(Prisma.sql`
    WITH daily_spot_prices AS (
      SELECT DISTINCT ON (asset_id, date)
        asset_id,
        (created_at AT TIME ZONE 'UTC')::date AS date,
        usd
      FROM prices
      WHERE created_at >= ${spotFrom}
      ORDER BY asset_id, (created_at AT TIME ZONE 'UTC')::date, created_at DESC
    )
    SELECT
      ${bucketSql} AS bucket,
      ${packetMetricValue(params.metric, params.nativeDenom)} AS value,
      ${PACKET_COVERAGE_SELECT_SQL}
    FROM ibc_packets p
    LEFT JOIN assets a ON a.native_denom = ${RESOLVED_PACKET_DENOM_SQL}
    LEFT JOIN price_history ph ON ph.asset_id = a.id
      AND ph.date = (p.event_time AT TIME ZONE 'UTC')::date
    LEFT JOIN daily_spot_prices dsp ON dsp.asset_id = a.id
      AND dsp.date = (p.event_time AT TIME ZONE 'UTC')::date
    WHERE p.event_time IS NOT NULL
      AND p.event_time >= ${params.from}
      AND ${channelClause}
      AND ${packetDirectionFilter(params.direction)}
      ${chainClause}
      AND ${DELIVERED_PACKET_SQL}
    GROUP BY ${bucketSql}
    ORDER BY ${bucketSql} ASC
  `);
};

const dailyMetricValue = (
  metric: TimeseriesMetric,
  nativeDenom: string,
): { expression: Prisma.Sql; denomClause: Prisma.Sql } => {
  if (metric === 'transfers') {
    return {
      expression: Prisma.sql`COALESCE(SUM(d.transfers_count), 0)::bigint`,
      denomClause: Prisma.sql`d.denom IS NULL`,
    };
  }
  if (metric === 'volume_usd') {
    return {
      expression: Prisma.sql`COALESCE(SUM(d.amount_usd), 0)`,
      denomClause: Prisma.sql`d.denom IS NOT NULL`,
    };
  }
  const denom = metric === 'volume_atom' ? ATOM_METADATA.nativeDenom : nativeDenom;
  return {
    expression: Prisma.sql`COALESCE(SUM(d.amount_native), 0)`,
    denomClause: Prisma.sql`d.denom = ${denom}`,
  };
};

const queryDailyStats = async (params: {
  metric: TimeseriesMetric;
  direction: TimeseriesDirection;
  from: Date;
  toExclusive: Date;
  channelIdSrc?: string;
  chain: ChainName | null;
  nativeDenom: string;
}): Promise<RawTimeseriesRow[]> => {
  const channelClause =
    params.channelIdSrc === undefined
      ? Prisma.sql`d.channel_id_src IS NULL`
      : Prisma.sql`d.channel_id_src = ${params.channelIdSrc}`;
  const chainClause = params.chain ? Prisma.sql`AND d.chain = ${params.chain}` : Prisma.empty;
  const metric = dailyMetricValue(params.metric, params.nativeDenom);

  return db.$queryRaw<RawTimeseriesRow[]>(Prisma.sql`
    WITH count_rows AS (
      SELECT d.*
      FROM ibc_daily_stats d
      WHERE ${channelClause}
        AND d.denom IS NULL
        AND d.date >= ${params.from}
        AND d.date < ${params.toExclusive}
        AND ${dailyDirectionFilter(params.direction)}
        ${chainClause}
    ),
    coverage_by_date AS (
      SELECT
        d.date AS bucket,
        ${dailyCoverageSelectSql(Prisma.sql`WHERE d2.date = d.date`)}
      FROM count_rows d
      GROUP BY d.date
    ),
    value_by_date AS (
      SELECT d.date AS bucket, ${metric.expression} AS value
      FROM ibc_daily_stats d
      WHERE ${channelClause}
        AND ${metric.denomClause}
        AND d.date >= ${params.from}
        AND d.date < ${params.toExclusive}
        AND ${dailyDirectionFilter(params.direction)}
        ${chainClause}
      GROUP BY d.date
    )
    SELECT
      coverage_by_date.bucket,
      COALESCE(value_by_date.value, 0) AS value,
      coverage_by_date.eligible_packets,
      coverage_by_date.priced_packets,
      coverage_by_date.unpriced_packets,
      coverage_by_date.unpriced_denoms
    FROM coverage_by_date
    LEFT JOIN value_by_date USING (bucket)
    ORDER BY coverage_by_date.bucket ASC
  `);
};

const emptyCoverageRow = (): IbcCoverageCountRow => ({
  eligible_packets: BigInt(0),
  priced_packets: BigInt(0),
  unpriced_packets: BigInt(0),
  unpriced_denoms: [],
});

const formatValue = (
  metric: TimeseriesMetric,
  value: Prisma.Decimal | bigint | null,
  chain: ChainName | null,
): string => {
  if (value === null) return '0';
  if (metric === 'transfers') {
    return typeof value === 'bigint' ? value.toString() : value.toFixed(0);
  }
  if (metric === 'volume_usd') {
    return typeof value === 'bigint' ? value.toString() : value.toFixed(2);
  }
  const decimals =
    metric === 'volume_native' && chain
      ? getChainMetadata(chain).nativeDecimals
      : ATOM_METADATA.nativeDecimals;
  const raw = typeof value === 'bigint' ? value.toString() : value.toFixed(0);
  return formatNative(raw, decimals) ?? '0';
};

const correctedPoint = (
  date: string,
  value: string,
  coverageRow: IbcCoverageCountRow,
): TimeseriesPoint => ({
  date,
  value,
  ...toIbcCoverageStatus('corrected', mergeIbcCoverageRows([coverageRow])),
});

const resolveNativeDenom = (metric: TimeseriesMetric, chain: ChainName | null): string => {
  if (metric === 'volume_native' && chain === null) {
    throw new Error('volume_native requires a chain-scoped timeseries request');
  }
  return chain ? getChainMetadata(chain).nativeDenom : ATOM_METADATA.nativeDenom;
};

export const getTimeseriesHourly = async (params: {
  metric: TimeseriesMetric;
  direction: TimeseriesDirection;
  channelIdSrc?: string;
  chain: ChainName | null;
}): Promise<TimeseriesResult> => {
  const now = new Date();
  const currentHour = new Date(now);
  currentHour.setUTCMinutes(0, 0, 0);
  const from = new Date(currentHour.getTime() - (HOURLY_BUCKETS - 1) * MS_PER_HOUR);
  const nativeDenom = resolveNativeDenom(params.metric, params.chain);
  const [rows, context] = await Promise.all([
    queryPacketBuckets({
      bucket: 'hour',
      metric: params.metric,
      direction: params.direction,
      from,
      channelIdSrc: params.channelIdSrc,
      chain: params.chain,
      nativeDenom,
    }),
    getIbcAggregationContext(params.chain, now),
  ]);

  const byHour = new Map(rows.map((row) => [row.bucket.toISOString(), row]));
  const data: TimeseriesPoint[] = [];
  for (let index = 0; index < HOURLY_BUCKETS; index += 1) {
    const date = new Date(from.getTime() + index * MS_PER_HOUR);
    const key = date.toISOString();
    const row = byHour.get(key);
    data.push(
      correctedPoint(
        key,
        formatValue(params.metric, row?.value ?? null, params.chain),
        row ?? emptyCoverageRow(),
      ),
    );
  }

  return { data, ...context.freshness };
};

export const getTimeseries = async (params: {
  metric: TimeseriesMetric;
  direction: TimeseriesDirection;
  from?: Date;
  to?: Date;
  channelIdSrc?: string;
  chain: ChainName | null;
}): Promise<TimeseriesResult> => {
  const now = new Date();
  const midnight = toUtcDate(now);
  const toBoundary = params.to ? toUtcDate(params.to) : midnight;
  const fromRaw = params.from
    ? toUtcDate(params.from)
    : new Date(toBoundary.getTime() - (DEFAULT_DAYS - 1) * MS_PER_DAY);
  const earliestFrom = new Date(toBoundary.getTime() - (MAX_RANGE_DAYS - 1) * MS_PER_DAY);
  const fromBoundary = fromRaw.getTime() < earliestFrom.getTime() ? earliestFrom : fromRaw;
  const requestedToExclusive = new Date(toBoundary.getTime() + MS_PER_DAY);
  const includesToday =
    fromBoundary.getTime() <= midnight.getTime() && toBoundary.getTime() >= midnight.getTime();
  const dailyToExclusive = includesToday ? midnight : requestedToExclusive;
  const nativeDenom = resolveNativeDenom(params.metric, params.chain);

  const [dailyRows, todayRows, context] = await Promise.all([
    queryDailyStats({
      metric: params.metric,
      direction: params.direction,
      from: fromBoundary,
      toExclusive: dailyToExclusive,
      channelIdSrc: params.channelIdSrc,
      chain: params.chain,
      nativeDenom,
    }),
    includesToday
      ? queryPacketBuckets({
          bucket: 'day',
          metric: params.metric,
          direction: params.direction,
          from: midnight,
          channelIdSrc: params.channelIdSrc,
          chain: params.chain,
          nativeDenom,
        })
      : Promise.resolve([]),
    getIbcAggregationContext(params.chain, now),
  ]);

  const dailyByDate = new Map(dailyRows.map((row) => [formatYmd(row.bucket), row]));
  const todayRow = todayRows[0];
  const data: TimeseriesPoint[] = [];

  for (
    let timestamp = fromBoundary.getTime();
    timestamp <= toBoundary.getTime();
    timestamp += MS_PER_DAY
  ) {
    const bucketStart = new Date(timestamp);
    const key = formatYmd(bucketStart);
    const isToday = timestamp === midnight.getTime();
    const row = isToday ? todayRow : dailyByDate.get(key);
    const value = formatValue(params.metric, row?.value ?? null, params.chain);

    if (isToday) {
      data.push(correctedPoint(key, value, row ?? emptyCoverageRow()));
      continue;
    }

    const quality = classifyIbcDailyRange(
      bucketStart,
      new Date(timestamp + MS_PER_DAY),
      context.sourceStates,
    );
    data.push({
      date: key,
      value,
      ...toIbcCoverageStatus(
        quality,
        quality === 'corrected' ? mergeIbcCoverageRows([row ?? emptyCoverageRow()]) : undefined,
      ),
    });
  }

  return { data, ...context.freshness };
};
