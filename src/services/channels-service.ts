import { Prisma } from '@prisma/client';

import { db } from '@/db';
import { formatNative } from '@/utils/format-amount';

export type ChannelsDirection = 'outgoing' | 'incoming' | 'both';
export type ChannelsPeriod = '24h' | '7d' | '30d';
export type ChannelsSort = 'transfers' | 'volume_atom' | 'last_activity';
export type SortOrder = 'asc' | 'desc';

export type ChannelDto = {
  channel_id_src: string;
  port_id_src: string;
  channel_id_dst: string | null;
  transfers: { '24h': number; '7d': number; '30d': number };
  volume_atom: { '24h': string; '7d': string; '30d': string };
  volume_usd: { '24h': string; '7d': string; '30d': string };
  success_rate_30d: number | null;
  last_activity: string | null;
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
  last_activity: Date | null;
  total_30d: bigint;
  acked_30d: bigint;
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
      SELECT DISTINCT channel_id_src, port_id_src FROM recent
    ),
    last_dst AS (
      SELECT DISTINCT ON (channel_id_src, port_id_src)
        channel_id_src, port_id_src, channel_id_dst, event_time
      FROM recent
      ORDER BY channel_id_src, port_id_src, event_time DESC NULLS LAST
    ),
    stats AS (
      SELECT
        channel_id_src,
        port_id_src,
        MAX(event_time) AS last_activity,
        COUNT(*)::bigint AS total_30d,
        COUNT(*) FILTER (WHERE status = 'acknowledged')::bigint AS acked_30d
      FROM recent
      GROUP BY channel_id_src, port_id_src
    )
    SELECT
      k.channel_id_src,
      k.port_id_src,
      ld.channel_id_dst,
      s.last_activity,
      s.total_30d,
      s.acked_30d
    FROM keys k
    LEFT JOIN last_dst ld
      ON ld.channel_id_src = k.channel_id_src AND ld.port_id_src = k.port_id_src
    LEFT JOIN stats s
      ON s.channel_id_src = k.channel_id_src AND s.port_id_src = k.port_id_src
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
        SUM(amount_native) AS amount_native,
        SUM(amount_usd) AS amount_usd
      FROM ibc_daily_stats
      WHERE channel_id_src IS NOT NULL
        AND denom = ${ATOM_DENOM}
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
  return db.$queryRaw<TodayAggRow[]>(Prisma.sql`
    SELECT
      p.channel_id_src,
      COUNT(*)::bigint AS transfers_count,
      COALESCE(SUM(CASE WHEN p.denom = ${ATOM_DENOM} THEN p.amount END), 0) AS amount_native,
      COALESCE(
        SUM(
          CASE WHEN p.denom = ${ATOM_DENOM} AND ph.usd IS NOT NULL
            THEN (p.amount / POWER(10::numeric, ${ATOM_DECIMALS})) * ph.usd
          END
        ),
        0
      ) AS amount_usd
    FROM ibc_packets p
    LEFT JOIN assets a ON a.native_denom = p.denom
    LEFT JOIN price_history ph ON ph.asset_id = a.id
      AND ph.date = (p.event_time AT TIME ZONE 'UTC')::date
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

  const [meta, dailyRows, todayRows] = await Promise.all([
    queryChannelsMeta(params.direction, thirtyDaysAgo),
    queryDailyAggregates(params.direction, thirtyDaysAgo, midnight),
    queryTodayAggregates(params.direction, midnight),
  ]);

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

  const today24Rows = await db.$queryRaw<TodayAggRow[]>(Prisma.sql`
    SELECT
      p.channel_id_src,
      COUNT(*)::bigint AS transfers_count,
      COALESCE(SUM(CASE WHEN p.denom = ${ATOM_DENOM} THEN p.amount END), 0) AS amount_native,
      COALESCE(
        SUM(
          CASE WHEN p.denom = ${ATOM_DENOM} AND ph.usd IS NOT NULL
            THEN (p.amount / POWER(10::numeric, ${ATOM_DECIMALS})) * ph.usd
          END
        ),
        0
      ) AS amount_usd
    FROM ibc_packets p
    LEFT JOIN assets a ON a.native_denom = p.denom
    LEFT JOIN price_history ph ON ph.asset_id = a.id
      AND ph.date = (p.event_time AT TIME ZONE 'UTC')::date
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
    const total = Number(m.total_30d);
    const acked = Number(m.acked_30d);
    return {
      channel_id_src: m.channel_id_src,
      port_id_src: m.port_id_src,
      channel_id_dst: m.channel_id_dst,
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
      success_rate_30d: total > 0 ? acked / total : null,
      last_activity: m.last_activity !== null ? m.last_activity.toISOString() : null,
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
