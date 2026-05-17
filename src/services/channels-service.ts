import { Prisma } from '@prisma/client';

import { db } from '@/db';
import { formatNative } from '@/utils/format-amount';
import { formatDenomDisplay } from '@/utils/format-denom';

export type ChannelsDirection = 'outgoing' | 'incoming' | 'both';
export type ChannelsPeriod = '24h' | '7d' | '30d';
export type ChannelsSort =
  | 'transfers'
  | 'volume_atom'
  | 'volume_usd'
  | 'last_activity';
export type SortOrder = 'asc' | 'desc';

export type ChannelDenom = {
  display: string;
  native_denom: string;
  symbol: string | null;
  decimals: number | null;
  count: number;
  amount_native: string;
  amount_usd: string;
  raws: string[];
};

export type ChannelDto = {
  channel_id_src: string;
  port_id_src: string;
  channel_id_dst: string | null;
  counterparty_chain_id: string | null;
  counterparty_chain_name: string | null;
  transfers: { '24h': number; '7d': number; '30d': number };
  volume_atom: { '24h': string; '7d': string; '30d': string };
  volume_usd: { '24h': string; '7d': string; '30d': string };
  success_rate_30d: number | null;
  last_activity: string | null;
  denoms: ChannelDenom[];
};

export type ChannelsResult = {
  data: ChannelDto[];
  page: { total: number; limit: number; offset: number };
};

const ATOM_DENOM = 'uatom';
const ATOM_DECIMALS = 6;
const MS_PER_DAY = 86_400_000;

const directionFilter = (direction: ChannelsDirection): Prisma.Sql =>
  direction === 'both'
    ? Prisma.sql`direction IN ('outgoing','incoming')`
    : Prisma.sql`direction = ${direction}`;

type ChannelMetaRow = {
  channel_id_src: string;
  port_id_src: string;
  channel_id_dst: string | null;
  counterparty_chain_id: string | null;
  counterparty_chain_name: string | null;
  last_activity: Date | null;
  delivered_30d: bigint;
  failed_30d: bigint;
};

const queryChannelsMeta = async (
  direction: ChannelsDirection,
  thirtyDaysAgo: Date,
): Promise<ChannelMetaRow[]> => {
  return db.$queryRaw<ChannelMetaRow[]>(Prisma.sql`
    WITH recent AS (
      SELECT *
      FROM ibc_packets
      WHERE event_time IS NOT NULL
        AND event_time >= ${thirtyDaysAgo}
        AND ${directionFilter(direction)}
    ),
    keys AS (
      SELECT DISTINCT channel_id_src FROM recent
    ),
    primary_port AS (
      SELECT channel_id_src, port_id_src
      FROM (
        SELECT
          channel_id_src,
          port_id_src,
          ROW_NUMBER() OVER (
            PARTITION BY channel_id_src ORDER BY COUNT(*) DESC
          ) AS rn
        FROM recent
        GROUP BY channel_id_src, port_id_src
      ) t
      WHERE rn = 1
    ),
    last_dst AS (
      SELECT DISTINCT ON (channel_id_src)
        channel_id_src, channel_id_dst, event_time
      FROM recent
      ORDER BY channel_id_src, event_time DESC NULLS LAST
    ),
    stats AS (
      SELECT
        channel_id_src,
        MAX(event_time) AS last_activity,
        COUNT(*) FILTER (
          WHERE (direction = 'outgoing' AND status = 'acknowledged')
             OR (direction = 'incoming' AND status = 'received')
        )::bigint AS delivered_30d,
        COUNT(*) FILTER (WHERE status IN ('timeout', 'failed'))::bigint AS failed_30d
      FROM recent
      GROUP BY channel_id_src
    )
    SELECT
      k.channel_id_src,
      pp.port_id_src,
      ld.channel_id_dst,
      COALESCE(ic_out.counterparty_chain_id, ic_in.counterparty_chain_id) AS counterparty_chain_id,
      COALESCE(ic_out.counterparty_chain_name, ic_in.counterparty_chain_name) AS counterparty_chain_name,
      s.last_activity,
      s.delivered_30d,
      s.failed_30d
    FROM keys k
    LEFT JOIN primary_port pp ON pp.channel_id_src = k.channel_id_src
    LEFT JOIN last_dst ld ON ld.channel_id_src = k.channel_id_src
    LEFT JOIN stats s ON s.channel_id_src = k.channel_id_src
    LEFT JOIN ibc_channels ic_out
      ON ic_out.channel_id_src = k.channel_id_src
     AND ic_out.port_id_src = pp.port_id_src
    LEFT JOIN ibc_channels ic_in
      ON ic_in.counterparty_channel_id = k.channel_id_src
     AND ic_in.counterparty_port_id = pp.port_id_src
     AND ic_in.channel_id_src = ld.channel_id_dst
  `);
};

type ChannelDenomRow = {
  channel_id_src: string;
  base_denom: string;
  raw_denom: string | null;
  symbol: string | null;
  decimals: number | null;
  count: bigint;
  amount_native: Prisma.Decimal | null;
  amount_usd: Prisma.Decimal | null;
};

const TOP_DENOMS_PER_CHANNEL = 3;

const queryChannelDenoms = async (
  direction: ChannelsDirection,
  thirtyDaysAgo: Date,
): Promise<ChannelDenomRow[]> => {
  return db.$queryRaw<ChannelDenomRow[]>(Prisma.sql`
    WITH daily_spot_prices AS (
      SELECT DISTINCT ON (asset_id, date)
        asset_id,
        (created_at AT TIME ZONE 'UTC')::date AS date,
        usd
      FROM prices
      ORDER BY asset_id, (created_at AT TIME ZONE 'UTC')::date, created_at DESC
    )
    SELECT
      p.channel_id_src,
      resolve_base_denom(p.denom) AS base_denom,
      p.denom AS raw_denom,
      a.symbol AS symbol,
      a.decimals AS decimals,
      COUNT(*)::bigint AS count,
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
      AND p.event_time >= ${thirtyDaysAgo}
      AND p.denom IS NOT NULL
      AND ${directionFilter(direction)}
    GROUP BY p.channel_id_src, resolve_base_denom(p.denom), p.denom, a.symbol, a.decimals
  `);
};

type DailyAggRow = {
  channel_id_src: string;
  date: Date;
  transfers_count: bigint | null;
  amount_native: Prisma.Decimal | null;
  amount_usd: Prisma.Decimal | null;
};

const queryDailyAggregates = async (
  direction: ChannelsDirection,
  thirtyDaysAgo: Date,
  midnight: Date,
): Promise<DailyAggRow[]> => {
  return db.$queryRaw<DailyAggRow[]>(Prisma.sql`
    WITH counts AS (
      SELECT channel_id_src, date, SUM(transfers_count)::bigint AS transfers_count
      FROM ibc_daily_stats
      WHERE channel_id_src IS NOT NULL
        AND denom IS NULL
        AND date >= ${thirtyDaysAgo}::date
        AND date < ${midnight}::date
        AND ${directionFilter(direction)}
      GROUP BY channel_id_src, date
    ),
    vols AS (
      SELECT
        channel_id_src,
        date,
        SUM(amount_native) FILTER (WHERE denom = ${ATOM_DENOM}) AS amount_native,
        SUM(amount_usd) FILTER (WHERE denom IS NOT NULL) AS amount_usd
      FROM ibc_daily_stats
      WHERE channel_id_src IS NOT NULL
        AND denom IS NOT NULL
        AND date >= ${thirtyDaysAgo}::date
        AND date < ${midnight}::date
        AND ${directionFilter(direction)}
      GROUP BY channel_id_src, date
    )
    SELECT
      COALESCE(c.channel_id_src, v.channel_id_src) AS channel_id_src,
      COALESCE(c.date, v.date) AS date,
      c.transfers_count,
      v.amount_native,
      v.amount_usd
    FROM counts c
    FULL OUTER JOIN vols v
      ON c.channel_id_src = v.channel_id_src AND c.date = v.date
  `);
};

type TodayAggRow = {
  channel_id_src: string;
  transfers_count: bigint;
  amount_native: Prisma.Decimal | null;
  amount_usd: Prisma.Decimal | null;
};

const queryTodayAggregates = async (
  direction: ChannelsDirection,
  midnight: Date,
): Promise<TodayAggRow[]> => {
  const spotFrom = new Date(midnight.getTime() - MS_PER_DAY);
  return db.$queryRaw<TodayAggRow[]>(Prisma.sql`
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
      p.channel_id_src,
      COUNT(*)::bigint AS transfers_count,
      COALESCE(SUM(CASE WHEN resolve_base_denom(p.denom) = ${ATOM_DENOM} THEN p.amount END), 0) AS amount_native,
      COALESCE(
        SUM(
          CASE WHEN a.id IS NOT NULL AND COALESCE(ph.usd, dsp.usd) IS NOT NULL
            THEN (p.amount / POWER(10::numeric, a.decimals)) * COALESCE(ph.usd, dsp.usd)
          END
        ),
        0
      ) AS amount_usd
    FROM ibc_packets p
    LEFT JOIN assets a ON a.native_denom = resolve_base_denom(p.denom)
    LEFT JOIN price_history ph ON ph.asset_id = a.id
      AND ph.date = (p.event_time AT TIME ZONE 'UTC')::date
    LEFT JOIN daily_spot_prices dsp ON dsp.asset_id = a.id
      AND dsp.date = (p.event_time AT TIME ZONE 'UTC')::date
    WHERE p.event_time IS NOT NULL
      AND p.event_time >= ${midnight}
      AND ${directionFilter(direction)}
    GROUP BY p.channel_id_src
  `);
};

type Bucket = { count: number; atom: Prisma.Decimal; usd: Prisma.Decimal };
type ChannelBuckets = {
  '24h': Bucket;
  '7d': Bucket;
  '30d': Bucket;
};

const newBuckets = (): ChannelBuckets => ({
  '24h': { count: 0, atom: new Prisma.Decimal(0), usd: new Prisma.Decimal(0) },
  '7d': { count: 0, atom: new Prisma.Decimal(0), usd: new Prisma.Decimal(0) },
  '30d': { count: 0, atom: new Prisma.Decimal(0), usd: new Prisma.Decimal(0) },
});

const formatAtom = (value: Prisma.Decimal): string =>
  formatNative(value.toFixed(0), ATOM_DECIMALS) ?? '0';

const formatUsd = (value: Prisma.Decimal): string => value.toFixed(2);

const compareDto = (sort: ChannelsSort, order: SortOrder, period: ChannelsPeriod) => {
  const dir = order === 'asc' ? 1 : -1;
  return (a: ChannelDto, b: ChannelDto): number => {
    if (sort === 'transfers') {
      return (a.transfers[period] - b.transfers[period]) * dir;
    }
    if (sort === 'volume_atom') {
      const cmp = Number(a.volume_atom[period]) - Number(b.volume_atom[period]);
      return cmp * dir;
    }
    if (sort === 'volume_usd') {
      const cmp = Number(a.volume_usd[period]) - Number(b.volume_usd[period]);
      return cmp * dir;
    }
    const aT = a.last_activity ? new Date(a.last_activity).getTime() : 0;
    const bT = b.last_activity ? new Date(b.last_activity).getTime() : 0;
    return (aT - bT) * dir;
  };
};

export const listChannels = async (params: {
  direction: ChannelsDirection;
  period: ChannelsPeriod;
  sort: ChannelsSort;
  order: SortOrder;
  limit: number;
  offset: number;
}): Promise<ChannelsResult> => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(midnight.getTime() - 30 * MS_PER_DAY);
  const sevenDaysAgo = new Date(midnight.getTime() - 7 * MS_PER_DAY);
  const window24hStart = new Date(now.getTime() - MS_PER_DAY);

  const [meta, dailyRows, todayRows, denomRows] = await Promise.all([
    queryChannelsMeta(params.direction, thirtyDaysAgo),
    queryDailyAggregates(params.direction, thirtyDaysAgo, midnight),
    queryTodayAggregates(params.direction, midnight),
    queryChannelDenoms(params.direction, thirtyDaysAgo),
  ]);

  type DenomEntry = {
    symbol: string | null;
    decimals: number | null;
    count: number;
    amount_native: Prisma.Decimal;
    amount_usd: Prisma.Decimal;
    raws: Set<string>;
  };
  const denomsAggByChannel = new Map<string, Map<string, DenomEntry>>();
  for (const r of denomRows) {
    const channelKey = r.channel_id_src;
    const denomKey = r.base_denom;
    const agg =
      denomsAggByChannel.get(channelKey) ?? new Map<string, DenomEntry>();
    const entry =
      agg.get(denomKey) ?? {
        symbol: r.symbol,
        decimals: r.decimals,
        count: 0,
        amount_native: new Prisma.Decimal(0),
        amount_usd: new Prisma.Decimal(0),
        raws: new Set<string>(),
      };
    if (entry.symbol === null && r.symbol !== null) entry.symbol = r.symbol;
    if (entry.decimals === null && r.decimals !== null) {
      entry.decimals = r.decimals;
    }
    entry.count += Number(r.count);
    if (r.amount_native !== null) {
      entry.amount_native = entry.amount_native.add(r.amount_native);
    }
    if (r.amount_usd !== null) {
      entry.amount_usd = entry.amount_usd.add(r.amount_usd);
    }
    if (r.raw_denom) entry.raws.add(r.raw_denom);
    agg.set(denomKey, entry);
    denomsAggByChannel.set(channelKey, agg);
  }

  const denomsByChannel = new Map<string, ChannelDenom[]>();
  for (const [channelKey, agg] of denomsAggByChannel) {
    const sorted = [...agg.entries()]
      .map(([base_denom, entry]) => ({
        display: formatDenomDisplay(base_denom, entry.symbol),
        native_denom: base_denom,
        symbol: entry.symbol,
        decimals: entry.decimals,
        count: entry.count,
        amount_native: entry.amount_native.toFixed(0),
        amount_usd: entry.amount_usd.toFixed(2),
        raws: [...entry.raws],
      }))
      .sort((a, b) => {
        const cmp = Number(b.amount_usd) - Number(a.amount_usd);
        if (cmp !== 0) return cmp;
        return b.count - a.count;
      })
      .slice(0, TOP_DENOMS_PER_CHANNEL);
    denomsByChannel.set(channelKey, sorted);
  }

  const buckets = new Map<string, ChannelBuckets>();
  for (const m of meta) {
    buckets.set(m.channel_id_src, newBuckets());
  }

  for (const r of dailyRows) {
    const b = buckets.get(r.channel_id_src);
    if (!b) continue;
    const rowDate = r.date;
    const count = r.transfers_count ? Number(r.transfers_count) : 0;
    const atom = r.amount_native ?? new Prisma.Decimal(0);
    const usd = r.amount_usd ?? new Prisma.Decimal(0);

    if (rowDate >= sevenDaysAgo) {
      b['7d'].count += count;
      b['7d'].atom = b['7d'].atom.add(atom);
      b['7d'].usd = b['7d'].usd.add(usd);
    }
    b['30d'].count += count;
    b['30d'].atom = b['30d'].atom.add(atom);
    b['30d'].usd = b['30d'].usd.add(usd);
  }

  for (const r of todayRows) {
    const b = buckets.get(r.channel_id_src);
    if (!b) continue;
    const count = Number(r.transfers_count);
    const atom = r.amount_native ?? new Prisma.Decimal(0);
    const usd = r.amount_usd ?? new Prisma.Decimal(0);

    b['7d'].count += count;
    b['7d'].atom = b['7d'].atom.add(atom);
    b['7d'].usd = b['7d'].usd.add(usd);
    b['30d'].count += count;
    b['30d'].atom = b['30d'].atom.add(atom);
    b['30d'].usd = b['30d'].usd.add(usd);
  }

  const window24hSpotFrom = new Date(window24hStart.getTime() - MS_PER_DAY);
  const today24Rows = await db.$queryRaw<TodayAggRow[]>(Prisma.sql`
    WITH daily_spot_prices AS (
      SELECT DISTINCT ON (asset_id, date)
        asset_id,
        (created_at AT TIME ZONE 'UTC')::date AS date,
        usd
      FROM prices
      WHERE created_at >= ${window24hSpotFrom}
      ORDER BY asset_id, (created_at AT TIME ZONE 'UTC')::date, created_at DESC
    )
    SELECT
      p.channel_id_src,
      COUNT(*)::bigint AS transfers_count,
      COALESCE(SUM(CASE WHEN resolve_base_denom(p.denom) = ${ATOM_DENOM} THEN p.amount END), 0) AS amount_native,
      COALESCE(
        SUM(
          CASE WHEN a.id IS NOT NULL AND COALESCE(ph.usd, dsp.usd) IS NOT NULL
            THEN (p.amount / POWER(10::numeric, a.decimals)) * COALESCE(ph.usd, dsp.usd)
          END
        ),
        0
      ) AS amount_usd
    FROM ibc_packets p
    LEFT JOIN assets a ON a.native_denom = resolve_base_denom(p.denom)
    LEFT JOIN price_history ph ON ph.asset_id = a.id
      AND ph.date = (p.event_time AT TIME ZONE 'UTC')::date
    LEFT JOIN daily_spot_prices dsp ON dsp.asset_id = a.id
      AND dsp.date = (p.event_time AT TIME ZONE 'UTC')::date
    WHERE p.event_time IS NOT NULL
      AND p.event_time >= ${window24hStart}
      AND ${directionFilter(params.direction)}
    GROUP BY p.channel_id_src
  `);
  for (const r of today24Rows) {
    const b = buckets.get(r.channel_id_src);
    if (!b) continue;
    b['24h'].count = Number(r.transfers_count);
    b['24h'].atom = r.amount_native ?? new Prisma.Decimal(0);
    b['24h'].usd = r.amount_usd ?? new Prisma.Decimal(0);
  }

  const dtos: ChannelDto[] = meta.map((m) => {
    const b = buckets.get(m.channel_id_src) ?? newBuckets();
    const delivered = Number(m.delivered_30d);
    const failed = Number(m.failed_30d);
    const denom = delivered + failed;
    return {
      channel_id_src: m.channel_id_src,
      port_id_src: m.port_id_src,
      channel_id_dst: m.channel_id_dst,
      counterparty_chain_id: m.counterparty_chain_id,
      counterparty_chain_name: m.counterparty_chain_name,
      transfers: {
        '24h': b['24h'].count,
        '7d': b['7d'].count,
        '30d': b['30d'].count,
      },
      volume_atom: {
        '24h': formatAtom(b['24h'].atom),
        '7d': formatAtom(b['7d'].atom),
        '30d': formatAtom(b['30d'].atom),
      },
      volume_usd: {
        '24h': formatUsd(b['24h'].usd),
        '7d': formatUsd(b['7d'].usd),
        '30d': formatUsd(b['30d'].usd),
      },
      success_rate_30d: denom > 0 ? delivered / denom : null,
      last_activity: m.last_activity !== null ? m.last_activity.toISOString() : null,
      denoms: denomsByChannel.get(m.channel_id_src) ?? [],
    };
  });

  dtos.sort(compareDto(params.sort, params.order, params.period));
  const total = dtos.length;
  const sliced = dtos.slice(params.offset, params.offset + params.limit);

  return {
    data: sliced,
    page: { total, limit: params.limit, offset: params.offset },
  };
};
