import { Prisma } from '@prisma/client';

import { db } from '@/db';
import type { ChainName } from '@/lib/chains';
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

export type AssetsBreakdownResult = {
  data: AssetBreakdownRow[];
  totals: {
    transfers_count: number;
    amount_usd: string;
  };
  page: { total: number; limit: number; offset: number };
  as_of: string;
};

const MS_PER_DAY = 86_400_000;

const directionFilter = (direction: AssetsDirection): Prisma.Sql =>
  direction === 'both'
    ? Prisma.sql`direction IN ('outgoing','incoming')`
    : Prisma.sql`direction = ${direction}`;

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
): Promise<BreakdownRow[]> => {
  return db.$queryRaw<BreakdownRow[]>(Prisma.sql`
    WITH daily_spot_prices AS (
      SELECT DISTINCT ON (asset_id, date)
        asset_id,
        (created_at AT TIME ZONE 'UTC')::date AS date,
        usd
      FROM prices
      ORDER BY asset_id, (created_at AT TIME ZONE 'UTC')::date, created_at DESC
    )
    SELECT
      resolve_base_denom(p.denom) AS native_denom,
      a.symbol AS symbol,
      a.decimals AS decimals,
      COUNT(*)::bigint AS transfers_count,
      COALESCE(SUM(p.amount), 0) AS amount_native,
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
      AND p.denom IS NOT NULL
      AND ${directionFilter(direction)}
      ${chain ? Prisma.sql`AND p.chain = ${chain}` : Prisma.empty}
    GROUP BY resolve_base_denom(p.denom), a.symbol, a.decimals
  `);
};

const queryDailyBreakdown = async (
  direction: AssetsDirection,
  fromDate: Date,
  toDateExclusive: Date,
  chain: ChainName | null,
): Promise<BreakdownRow[]> => {
  return db.$queryRaw<BreakdownRow[]>(Prisma.sql`
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
      AND ${directionFilter(direction)}
      ${chain ? Prisma.sql`AND d.chain = ${chain}` : Prisma.empty}
    GROUP BY d.denom, a.symbol, a.decimals
  `);
};

type Bucket = {
  symbol: string | null;
  decimals: number | null;
  transfers_count: number;
  amount_native: Prisma.Decimal;
  amount_usd: Prisma.Decimal;
};

const mergeRows = (rows: BreakdownRow[][]): Map<string, Bucket> => {
  const out = new Map<string, Bucket>();
  for (const set of rows) {
    for (const r of set) {
      const key = r.native_denom;
      const bucket =
        out.get(key) ?? {
          symbol: r.symbol,
          decimals: r.decimals,
          transfers_count: 0,
          amount_native: new Prisma.Decimal(0),
          amount_usd: new Prisma.Decimal(0),
        };
      if (bucket.symbol === null && r.symbol !== null) bucket.symbol = r.symbol;
      if (bucket.decimals === null && r.decimals !== null) bucket.decimals = r.decimals;
      bucket.transfers_count += Number(r.transfers_count);
      if (r.amount_native !== null) {
        bucket.amount_native = bucket.amount_native.add(r.amount_native);
      }
      if (r.amount_usd !== null) {
        bucket.amount_usd = bucket.amount_usd.add(r.amount_usd);
      }
      out.set(key, bucket);
    }
  }
  return out;
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

  let rowsets: BreakdownRow[][];
  if (params.period === '24h') {
    const fromTime = new Date(now.getTime() - MS_PER_DAY);
    rowsets = [await queryPacketsBreakdown(params.direction, fromTime, params.chain)];
  } else {
    const days = params.period === '7d' ? 6 : 29;
    const fromDate = new Date(midnight.getTime() - days * MS_PER_DAY);
    const [daily, today] = await Promise.all([
      queryDailyBreakdown(params.direction, fromDate, midnight, params.chain),
      queryPacketsBreakdown(params.direction, midnight, params.chain),
    ]);
    rowsets = [daily, today];
  }

  const merged = mergeRows(rowsets);

  const totalsTransfers = [...merged.values()].reduce(
    (acc, b) => acc + b.transfers_count,
    0,
  );
  const totalsUsd = [...merged.values()].reduce(
    (acc, b) => acc.add(b.amount_usd),
    new Prisma.Decimal(0),
  );

  const allRows: AssetBreakdownRow[] = [...merged.entries()].map(
    ([native_denom, b]) => ({
      native_denom,
      symbol: b.symbol,
      decimals: b.decimals,
      display: formatDenomDisplay(native_denom, b.symbol),
      transfers_count: b.transfers_count,
      amount_native: b.amount_native.toFixed(0),
      amount_usd: b.amount_usd.toFixed(2),
    }),
  );

  const sortField: AssetsSort = params.sort ?? 'volume_usd';
  const sortOrder: SortOrder = params.order ?? 'desc';
  const dir = sortOrder === 'asc' ? 1 : -1;

  const comparator = (a: AssetBreakdownRow, b: AssetBreakdownRow): number => {
    let cmp: number;
    if (sortField === 'transfers') {
      cmp = a.transfers_count - b.transfers_count;
    } else if (sortField === 'volume_usd' || sortField === 'share') {
      cmp = Number(a.amount_usd) - Number(b.amount_usd);
    } else {
      cmp = 0;
    }
    if (cmp !== 0) return cmp * dir;
    const tieUsd = Number(a.amount_usd) - Number(b.amount_usd);
    if (tieUsd !== 0) return tieUsd * dir;
    return (a.transfers_count - b.transfers_count) * dir;
  };

  allRows.sort(comparator);

  const total = allRows.length;
  const offset = Math.max(0, params.offset ?? 0);
  const data = allRows.slice(offset, offset + params.limit);

  return {
    data,
    totals: {
      transfers_count: totalsTransfers,
      amount_usd: totalsUsd.toFixed(2),
    },
    page: { total, limit: params.limit, offset },
    as_of: now.toISOString(),
  };
};
