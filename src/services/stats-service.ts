import { Prisma } from '@prisma/client';

import { db } from '@/db';
import type { ChainName } from '@/lib/chains';
import { formatNative } from '@/utils/format-amount';

export type StatsDirection = 'outgoing' | 'incoming' | 'both';

export type StatsWindowCounts = { '24h': number; '7d': number; '30d': number };
export type StatsWindowAmounts = { '24h': string; '7d': string; '30d': string };

export type StatsResult = {
  transfers_count: StatsWindowCounts;
  volume_atom: StatsWindowAmounts;
  volume_usd: StatsWindowAmounts;
  as_of: string;
  per_chain?: StatsPerChainRow[];
};

export type StatsPerChainRow = {
  chain: ChainName;
  transfers_count: StatsWindowCounts;
  volume_atom: StatsWindowAmounts;
  volume_usd: StatsWindowAmounts;
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

const chainFilterSql = (chain: ChainName | null): Prisma.Sql =>
  chain ? Prisma.sql`AND chain = ${chain}` : Prisma.empty;

type PacketWindowRow = {
  transfers_count: bigint;
  amount_native: Prisma.Decimal | null;
  amount_usd: Prisma.Decimal | null;
};

const queryPacketsWindow = async (
  direction: StatsDirection,
  fromTime: Date,
  chain: ChainName | null,
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
      ${chain ? Prisma.sql`AND p.chain = ${chain}` : Prisma.empty}
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
  chain: ChainName | null,
): Promise<DailyWindowRow> => {
  const countRows = await db.$queryRaw<{ transfers_count: bigint }[]>(Prisma.sql`
    SELECT COALESCE(SUM(transfers_count), 0)::bigint AS transfers_count
    FROM ibc_daily_stats
    WHERE channel_id_src IS NULL
      AND denom IS NULL
      AND date >= ${fromDate}
      AND date < ${toDateExclusive}
      AND ${directionFilter(direction)}
      ${chainFilterSql(chain)}
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
      ${chainFilterSql(chain)}
  `);

  return {
    transfers_count: countRows[0]?.transfers_count ?? BigInt(0),
    amount_native: volRows[0]?.amount_native ?? null,
    amount_usd: volRows[0]?.amount_usd ?? null,
  };
};

type ChainBreakdownRow = {
  chain: string;
  transfers_count: bigint;
  amount_native: Prisma.Decimal | null;
  amount_usd: Prisma.Decimal | null;
};

const queryPacketsWindowByChain = async (
  direction: StatsDirection,
  fromTime: Date,
): Promise<ChainBreakdownRow[]> => {
  return db.$queryRaw<ChainBreakdownRow[]>(Prisma.sql`
    WITH daily_spot_prices AS (
      SELECT DISTINCT ON (asset_id, date)
        asset_id,
        (created_at AT TIME ZONE 'UTC')::date AS date,
        usd
      FROM prices
      ORDER BY asset_id, (created_at AT TIME ZONE 'UTC')::date, created_at DESC
    )
    SELECT
      p.chain AS chain,
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
    GROUP BY p.chain
  `);
};

const queryDailyWindowByChain = async (
  direction: StatsDirection,
  fromDate: Date,
  toDateExclusive: Date,
): Promise<ChainBreakdownRow[]> => {
  const countRows = await db.$queryRaw<{ chain: string; transfers_count: bigint }[]>(Prisma.sql`
    SELECT chain, COALESCE(SUM(transfers_count), 0)::bigint AS transfers_count
    FROM ibc_daily_stats
    WHERE channel_id_src IS NULL
      AND denom IS NULL
      AND date >= ${fromDate}
      AND date < ${toDateExclusive}
      AND ${directionFilter(direction)}
    GROUP BY chain
  `);

  const volRows = await db.$queryRaw<{
    chain: string;
    amount_native: Prisma.Decimal | null;
    amount_usd: Prisma.Decimal | null;
  }[]>(Prisma.sql`
    SELECT
      chain,
      COALESCE(SUM(amount_native) FILTER (WHERE denom = ${ATOM_DENOM}), 0) AS amount_native,
      COALESCE(SUM(amount_usd) FILTER (WHERE denom IS NOT NULL), 0) AS amount_usd
    FROM ibc_daily_stats
    WHERE channel_id_src IS NULL
      AND denom IS NOT NULL
      AND date >= ${fromDate}
      AND date < ${toDateExclusive}
      AND ${directionFilter(direction)}
    GROUP BY chain
  `);

  const byChain = new Map<string, ChainBreakdownRow>();
  for (const r of countRows) {
    byChain.set(r.chain, {
      chain: r.chain,
      transfers_count: r.transfers_count,
      amount_native: null,
      amount_usd: null,
    });
  }
  for (const r of volRows) {
    const existing = byChain.get(r.chain) ?? {
      chain: r.chain,
      transfers_count: BigInt(0),
      amount_native: null,
      amount_usd: null,
    };
    existing.amount_native = r.amount_native;
    existing.amount_usd = r.amount_usd;
    byChain.set(r.chain, existing);
  }
  return [...byChain.values()];
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
  chain: ChainName | null;
  breakdown?: 'chain';
}): Promise<StatsResult> => {
  const now = new Date();
  const midnight = todayUtcMidnight(now);

  const window24hStart = new Date(now.getTime() - MS_PER_DAY);
  const window7dDailyFrom = new Date(midnight.getTime() - 6 * MS_PER_DAY);
  const window30dDailyFrom = new Date(midnight.getTime() - 29 * MS_PER_DAY);

  const [w24h, today, daily7d, daily30d] = await Promise.all([
    queryPacketsWindow(params.direction, window24hStart, params.chain),
    queryPacketsWindow(params.direction, midnight, params.chain),
    queryDailyWindow(params.direction, window7dDailyFrom, midnight, params.chain),
    queryDailyWindow(params.direction, window30dDailyFrom, midnight, params.chain),
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

  const result: StatsResult = {
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

  if (params.breakdown === 'chain' && params.chain === null) {
    const [w24hByChain, todayByChain, daily7dByChain, daily30dByChain] = await Promise.all([
      queryPacketsWindowByChain(params.direction, window24hStart),
      queryPacketsWindowByChain(params.direction, midnight),
      queryDailyWindowByChain(params.direction, window7dDailyFrom, midnight),
      queryDailyWindowByChain(params.direction, window30dDailyFrom, midnight),
    ]);

    const allChains = new Set<string>();
    for (const r of w24hByChain) allChains.add(r.chain);
    for (const r of todayByChain) allChains.add(r.chain);
    for (const r of daily7dByChain) allChains.add(r.chain);
    for (const r of daily30dByChain) allChains.add(r.chain);

    const byChain = (rows: ChainBreakdownRow[]): Map<string, ChainBreakdownRow> => {
      const m = new Map<string, ChainBreakdownRow>();
      for (const r of rows) m.set(r.chain, r);
      return m;
    };
    const m24 = byChain(w24hByChain);
    const mToday = byChain(todayByChain);
    const m7 = byChain(daily7dByChain);
    const m30 = byChain(daily30dByChain);

    const per_chain: StatsPerChainRow[] = [...allChains].sort().map((name) => {
      const r24 = m24.get(name);
      const rToday = mToday.get(name);
      const r7 = m7.get(name);
      const r30 = m30.get(name);

      const cToday = rToday ? Number(rToday.transfers_count) : 0;
      const c24 = r24 ? Number(r24.transfers_count) : 0;
      const c7 = (r7 ? Number(r7.transfers_count) : 0) + cToday;
      const c30 = (r30 ? Number(r30.transfers_count) : 0) + cToday;

      const a24 = r24?.amount_native ?? null;
      const a7 = addDecimal(r7?.amount_native ?? null, rToday?.amount_native ?? null);
      const a30 = addDecimal(r30?.amount_native ?? null, rToday?.amount_native ?? null);

      const u24 = r24?.amount_usd ?? null;
      const u7 = addDecimal(r7?.amount_usd ?? null, rToday?.amount_usd ?? null);
      const u30 = addDecimal(r30?.amount_usd ?? null, rToday?.amount_usd ?? null);

      return {
        chain: name as ChainName,
        transfers_count: { '24h': c24, '7d': c7, '30d': c30 },
        volume_atom: {
          '24h': formatAtom(a24),
          '7d': formatAtom(a7),
          '30d': formatAtom(a30),
        },
        volume_usd: {
          '24h': formatUsd(u24),
          '7d': formatUsd(u7),
          '30d': formatUsd(u30),
        },
      };
    });

    result.per_chain = per_chain;
  }

  return result;
};
