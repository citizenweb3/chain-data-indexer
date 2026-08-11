import { Prisma } from '@prisma/client';

import { db } from '@/db';
import type { ChainName } from '@/lib/chains';
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
import {
  classifyIbcDailyRange,
  combineIbcCoverageQualities,
  getIbcAggregationContext,
  type IbcSourceState,
} from '@/services/ibc-aggregation-state';
import { formatDenomDisplay } from '@/utils/format-denom';

export type AssetsDirection = 'outgoing' | 'incoming' | 'both';
export type AssetsPeriod = '24h' | '7d' | '30d';
export type AssetsSort = 'transfers' | 'volume_usd' | 'share';
export type SortOrder = 'asc' | 'desc';

export type AssetBreakdownRow = {
  native_denom: string;
  symbol: string | null;
  decimals: number | null;
  display: string;
  transfers_count: number;
  amount_native: string;
  amount_usd: string;
};

export type AssetsBreakdownResult = IbcAggregationFreshness & {
  data: AssetBreakdownRow[];
  totals: {
    transfers_count: number;
    amount_usd: string;
  };
  page: { total: number; limit: number; offset: number };
  coverage: IbcCoverageStatus;
  as_of: string;
};

const MS_PER_DAY = 86_400_000;

const packetDirectionFilter = (direction: AssetsDirection): Prisma.Sql =>
  direction === 'both'
    ? Prisma.sql`p.direction IN ('outgoing','incoming')`
    : Prisma.sql`p.direction = ${direction}`;

const dailyDirectionFilter = (direction: AssetsDirection): Prisma.Sql =>
  direction === 'both'
    ? Prisma.sql`d.direction IN ('outgoing','incoming')`
    : Prisma.sql`d.direction = ${direction}`;

type BreakdownRow = {
  native_denom: string;
  symbol: string | null;
  decimals: number | null;
  transfers_count: bigint;
  amount_native: Prisma.Decimal | null;
  amount_usd: Prisma.Decimal | null;
};

const queryPacketsBreakdown = async (
  direction: AssetsDirection,
  fromTime: Date,
  chain: ChainName | null,
): Promise<BreakdownRow[]> =>
  db.$queryRaw<BreakdownRow[]>(Prisma.sql`
    WITH daily_spot_prices AS (
      SELECT DISTINCT ON (asset_id, date)
        asset_id,
        (created_at AT TIME ZONE 'UTC')::date AS date,
        usd
      FROM prices
      ORDER BY asset_id, (created_at AT TIME ZONE 'UTC')::date, created_at DESC
    ),
    resolved_packets AS (
      SELECT p.*, ${RESOLVED_PACKET_DENOM_SQL} AS native_denom
      FROM ibc_packets p
      WHERE p.event_time IS NOT NULL
        AND p.event_time >= ${fromTime}
        AND ${packetDirectionFilter(direction)}
        ${chain ? Prisma.sql`AND p.chain = ${chain}` : Prisma.empty}
        AND ${DELIVERED_PACKET_SQL}
    )
    SELECT
      p.native_denom,
      a.symbol AS symbol,
      a.decimals AS decimals,
      COUNT(*)::bigint AS transfers_count,
      COALESCE(SUM(p.amount), 0) AS amount_native,
      COALESCE(SUM(
        CASE WHEN ${PRICED_PACKET_SQL}
          THEN (p.amount / POWER(10::numeric, a.decimals)) * COALESCE(ph.usd, dsp.usd)
        END
      ), 0) AS amount_usd
    FROM resolved_packets p
    LEFT JOIN assets a ON a.native_denom = p.native_denom
    LEFT JOIN price_history ph ON ph.asset_id = a.id
      AND ph.date = (p.event_time AT TIME ZONE 'UTC')::date
    LEFT JOIN daily_spot_prices dsp ON dsp.asset_id = a.id
      AND dsp.date = (p.event_time AT TIME ZONE 'UTC')::date
    GROUP BY p.native_denom, a.symbol, a.decimals
  `);

const queryPacketsCoverage = async (
  direction: AssetsDirection,
  fromTime: Date,
  chain: ChainName | null,
): Promise<IbcCoverageCountRow> => {
  const rows = await db.$queryRaw<IbcCoverageCountRow[]>(Prisma.sql`
    WITH daily_spot_prices AS (
      SELECT DISTINCT ON (asset_id, date)
        asset_id,
        (created_at AT TIME ZONE 'UTC')::date AS date,
        usd
      FROM prices
      ORDER BY asset_id, (created_at AT TIME ZONE 'UTC')::date, created_at DESC
    )
    SELECT
      ${PACKET_COVERAGE_SELECT_SQL}
    FROM ibc_packets p
    LEFT JOIN assets a ON a.native_denom = ${RESOLVED_PACKET_DENOM_SQL}
    LEFT JOIN price_history ph ON ph.asset_id = a.id
      AND ph.date = (p.event_time AT TIME ZONE 'UTC')::date
    LEFT JOIN daily_spot_prices dsp ON dsp.asset_id = a.id
      AND dsp.date = (p.event_time AT TIME ZONE 'UTC')::date
    WHERE p.event_time IS NOT NULL
      AND p.event_time >= ${fromTime}
      AND ${packetDirectionFilter(direction)}
      ${chain ? Prisma.sql`AND p.chain = ${chain}` : Prisma.empty}
      AND ${DELIVERED_PACKET_SQL}
  `);
  return (
    rows[0] ?? {
      eligible_packets: BigInt(0),
      priced_packets: BigInt(0),
      unpriced_packets: BigInt(0),
      unpriced_denoms: [],
    }
  );
};

const queryDailyBreakdown = async (
  direction: AssetsDirection,
  fromDate: Date,
  toDateExclusive: Date,
  chain: ChainName | null,
): Promise<BreakdownRow[]> =>
  db.$queryRaw<BreakdownRow[]>(Prisma.sql`
    SELECT
      d.denom AS native_denom,
      a.symbol AS symbol,
      a.decimals AS decimals,
      COALESCE(SUM(d.transfers_count), 0)::bigint AS transfers_count,
      COALESCE(SUM(d.amount_native), 0) AS amount_native,
      COALESCE(SUM(d.amount_usd), 0) AS amount_usd
    FROM ibc_daily_stats d
    LEFT JOIN assets a ON a.native_denom = d.denom
    WHERE d.channel_id_src IS NULL
      AND d.denom IS NOT NULL
      AND d.date >= ${fromDate}::date
      AND d.date < ${toDateExclusive}::date
      AND ${dailyDirectionFilter(direction)}
      ${chain ? Prisma.sql`AND d.chain = ${chain}` : Prisma.empty}
    GROUP BY d.denom, a.symbol, a.decimals
  `);

const queryDailyCoverage = async (
  direction: AssetsDirection,
  fromDate: Date,
  toDateExclusive: Date,
  chain: ChainName | null,
): Promise<IbcCoverageCountRow> => {
  const rows = await db.$queryRaw<IbcCoverageCountRow[]>(Prisma.sql`
    WITH count_rows AS (
      SELECT d.*
      FROM ibc_daily_stats d
      WHERE d.channel_id_src IS NULL
        AND d.denom IS NULL
        AND d.date >= ${fromDate}::date
        AND d.date < ${toDateExclusive}::date
        AND ${dailyDirectionFilter(direction)}
        ${chain ? Prisma.sql`AND d.chain = ${chain}` : Prisma.empty}
    )
    SELECT
      ${dailyCoverageSelectSql()}
    FROM count_rows d
  `);
  return (
    rows[0] ?? {
      eligible_packets: BigInt(0),
      priced_packets: BigInt(0),
      unpriced_packets: BigInt(0),
      unpriced_denoms: [],
    }
  );
};

type Bucket = {
  symbol: string | null;
  decimals: number | null;
  transfers_count: number;
  amount_native: Prisma.Decimal;
  amount_usd: Prisma.Decimal;
};

const mergeRows = (rows: BreakdownRow[][]): Map<string, Bucket> => {
  const result = new Map<string, Bucket>();
  for (const rowset of rows) {
    for (const row of rowset) {
      const bucket = result.get(row.native_denom) ?? {
        symbol: row.symbol,
        decimals: row.decimals,
        transfers_count: 0,
        amount_native: new Prisma.Decimal(0),
        amount_usd: new Prisma.Decimal(0),
      };
      if (bucket.symbol === null && row.symbol !== null) bucket.symbol = row.symbol;
      if (bucket.decimals === null && row.decimals !== null) {
        bucket.decimals = row.decimals;
      }
      bucket.transfers_count += Number(row.transfers_count);
      if (row.amount_native !== null) {
        bucket.amount_native = bucket.amount_native.add(row.amount_native);
      }
      if (row.amount_usd !== null) {
        bucket.amount_usd = bucket.amount_usd.add(row.amount_usd);
      }
      result.set(row.native_denom, bucket);
    }
  }
  return result;
};

const buildPeriodCoverage = (
  period: AssetsPeriod,
  dailyFrom: Date | null,
  midnight: Date,
  rawCoverage: IbcCoverageCountRow,
  dailyCoverage: IbcCoverageCountRow | null,
  sourceStates: readonly IbcSourceState[],
): IbcCoverageStatus => {
  if (period === '24h') {
    return toIbcCoverageStatus('corrected', mergeIbcCoverageRows([rawCoverage]));
  }
  if (dailyFrom === null || dailyCoverage === null) {
    throw new Error('daily asset coverage is required for multi-day periods');
  }
  const quality = combineIbcCoverageQualities([
    classifyIbcDailyRange(dailyFrom, midnight, sourceStates),
    'corrected',
  ]);
  if (quality !== 'corrected') return toIbcCoverageStatus(quality);
  return toIbcCoverageStatus('corrected', mergeIbcCoverageRows([dailyCoverage, rawCoverage]));
};

export const getAssetsBreakdown = async (params: {
  direction: AssetsDirection;
  period: AssetsPeriod;
  limit: number;
  offset?: number;
  sort?: AssetsSort;
  order?: SortOrder;
  chain: ChainName | null;
}): Promise<AssetsBreakdownResult> => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(0, 0, 0, 0);
  const contextPromise = getIbcAggregationContext(params.chain, now);

  let rowsets: BreakdownRow[][];
  let rawCoverage: IbcCoverageCountRow;
  let dailyCoverage: IbcCoverageCountRow | null = null;
  let dailyFrom: Date | null = null;

  if (params.period === '24h') {
    const fromTime = new Date(now.getTime() - MS_PER_DAY);
    const [rows, coverage] = await Promise.all([
      queryPacketsBreakdown(params.direction, fromTime, params.chain),
      queryPacketsCoverage(params.direction, fromTime, params.chain),
    ]);
    rowsets = [rows];
    rawCoverage = coverage;
  } else {
    const days = params.period === '7d' ? 6 : 29;
    dailyFrom = new Date(midnight.getTime() - days * MS_PER_DAY);
    const [daily, today, historicalCoverage, todayCoverage] = await Promise.all([
      queryDailyBreakdown(params.direction, dailyFrom, midnight, params.chain),
      queryPacketsBreakdown(params.direction, midnight, params.chain),
      queryDailyCoverage(params.direction, dailyFrom, midnight, params.chain),
      queryPacketsCoverage(params.direction, midnight, params.chain),
    ]);
    rowsets = [daily, today];
    dailyCoverage = historicalCoverage;
    rawCoverage = todayCoverage;
  }

  const context = await contextPromise;
  const merged = mergeRows(rowsets);
  const totalsTransfers = [...merged.values()].reduce(
    (total, bucket) => total + bucket.transfers_count,
    0,
  );
  const totalsUsd = [...merged.values()].reduce(
    (total, bucket) => total.add(bucket.amount_usd),
    new Prisma.Decimal(0),
  );
  const allRows: AssetBreakdownRow[] = [...merged.entries()].map(([native_denom, bucket]) => ({
    native_denom,
    symbol: bucket.symbol,
    decimals: bucket.decimals,
    display: formatDenomDisplay(native_denom, bucket.symbol),
    transfers_count: bucket.transfers_count,
    amount_native: bucket.amount_native.toFixed(0),
    amount_usd: bucket.amount_usd.toFixed(2),
  }));

  const sortField = params.sort ?? 'volume_usd';
  const sortDirection = (params.order ?? 'desc') === 'asc' ? 1 : -1;
  allRows.sort((left, right) => {
    let comparison = 0;
    if (sortField === 'transfers') {
      comparison = left.transfers_count - right.transfers_count;
    } else {
      comparison = Number(left.amount_usd) - Number(right.amount_usd);
    }
    if (comparison !== 0) return comparison * sortDirection;
    const usdTieBreak = Number(left.amount_usd) - Number(right.amount_usd);
    if (usdTieBreak !== 0) return usdTieBreak * sortDirection;
    return (left.transfers_count - right.transfers_count) * sortDirection;
  });

  const total = allRows.length;
  const offset = Math.max(0, params.offset ?? 0);
  return {
    data: allRows.slice(offset, offset + params.limit),
    totals: {
      transfers_count: totalsTransfers,
      amount_usd: totalsUsd.toFixed(2),
    },
    page: { total, limit: params.limit, offset },
    coverage: buildPeriodCoverage(
      params.period,
      dailyFrom,
      midnight,
      rawCoverage,
      dailyCoverage,
      context.sourceStates,
    ),
    as_of: context.freshness.generated_at,
    ...context.freshness,
  };
};
