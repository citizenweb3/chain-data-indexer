import { Prisma } from '@prisma/client';

import { db } from '@/db';
import type { ChainName } from '@/lib/chains';
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
  chain: ChainName;
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
    ? Prisma.sql`p.direction IN ('outgoing','incoming')`
    : Prisma.sql`p.direction = ${direction}`;

const chainFilterP = (chain: ChainName | null): Prisma.Sql =>
  chain ? Prisma.sql`AND p.chain = ${chain}` : Prisma.empty;

const hubChannelExpr = Prisma.sql`
  CASE WHEN p.direction = 'outgoing' THEN p.channel_id_src
       WHEN p.direction = 'incoming' THEN p.channel_id_dst
  END
`;

type HubChannelRow = {
  chain: string;
  channel_id_src: string;
  port_id_src: string;
  counterparty_channel_id: string | null;
  counterparty_chain_id: string | null;
  counterparty_chain_name: string | null;
};

const queryHubChannels = async (chain: ChainName | null): Promise<HubChannelRow[]> => {
  return db.$queryRaw<HubChannelRow[]>(Prisma.sql`
    SELECT
      chain,
      channel_id_src,
      port_id_src,
      counterparty_channel_id,
      counterparty_chain_id,
      counterparty_chain_name
    FROM ibc_channels
    WHERE 1=1
      ${chain ? Prisma.sql`AND chain = ${chain}` : Prisma.empty}
  `);
};

type ChannelMetaRow = {
  chain: string;
  hub_channel: string | null;
  last_activity: Date | null;
  delivered_30d: bigint;
  failed_30d: bigint;
};

const queryChannelsMeta = async (
  direction: ChannelsDirection,
  thirtyDaysAgo: Date,
  chain: ChainName | null,
): Promise<ChannelMetaRow[]> => {
  return db.$queryRaw<ChannelMetaRow[]>(Prisma.sql`
    SELECT
      p.chain AS chain,
      ${hubChannelExpr} AS hub_channel,
      MAX(p.event_time) AS last_activity,
      COUNT(*) FILTER (
        WHERE (p.direction = 'outgoing' AND p.status = 'acknowledged')
           OR (p.direction = 'incoming' AND p.status = 'received')
      )::bigint AS delivered_30d,
      COUNT(*) FILTER (WHERE p.status IN ('timeout','failed'))::bigint AS failed_30d
    FROM ibc_packets p
    WHERE p.event_time IS NOT NULL
      AND p.event_time >= ${thirtyDaysAgo}
      AND ${directionFilter(direction)}
      ${chainFilterP(chain)}
    GROUP BY p.chain, hub_channel
  `);
};

type WindowAggRow = {
  chain: string;
  hub_channel: string | null;
  transfers_count: bigint;
  amount_native: Prisma.Decimal | null;
  amount_usd: Prisma.Decimal | null;
};

const queryWindowAggregates = async (
  direction: ChannelsDirection,
  fromTime: Date,
  chain: ChainName | null,
): Promise<WindowAggRow[]> => {
  const spotFrom = new Date(fromTime.getTime() - MS_PER_DAY);
  return db.$queryRaw<WindowAggRow[]>(Prisma.sql`
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
      p.chain AS chain,
      ${hubChannelExpr} AS hub_channel,
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
      AND p.event_time >= ${fromTime}
      AND ${directionFilter(direction)}
      ${chainFilterP(chain)}
    GROUP BY p.chain, hub_channel
  `);
};

type ChannelDenomRow = {
  chain: string;
  hub_channel: string | null;
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
  chain: ChainName | null,
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
      p.chain AS chain,
      ${hubChannelExpr} AS hub_channel,
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
      ${chainFilterP(chain)}
    GROUP BY p.chain, hub_channel, resolve_base_denom(p.denom), p.denom, a.symbol, a.decimals
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

const fillBucket = (b: Bucket, r: WindowAggRow): void => {
  b.count = Number(r.transfers_count);
  b.atom = r.amount_native ?? new Prisma.Decimal(0);
  b.usd = r.amount_usd ?? new Prisma.Decimal(0);
};

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

const makeKey = (chain: string, hubChannel: string): string => `${chain}::${hubChannel}`;

export const listChannels = async (params: {
  direction: ChannelsDirection;
  period: ChannelsPeriod;
  sort: ChannelsSort;
  order: SortOrder;
  limit: number;
  offset: number;
  chain: ChainName | null;
}): Promise<ChannelsResult> => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(midnight.getTime() - 29 * MS_PER_DAY);
  const sevenDaysAgo = new Date(midnight.getTime() - 6 * MS_PER_DAY);
  const window24hStart = new Date(now.getTime() - MS_PER_DAY);

  const [hubChannels, meta, agg24h, agg7d, agg30d, denomRows] = await Promise.all([
    queryHubChannels(params.chain),
    queryChannelsMeta(params.direction, thirtyDaysAgo, params.chain),
    queryWindowAggregates(params.direction, window24hStart, params.chain),
    queryWindowAggregates(params.direction, sevenDaysAgo, params.chain),
    queryWindowAggregates(params.direction, thirtyDaysAgo, params.chain),
    queryChannelDenoms(params.direction, thirtyDaysAgo, params.chain),
  ]);

  const metaByChannel = new Map<string, ChannelMetaRow>();
  for (const m of meta) {
    if (m.hub_channel === null) continue;
    metaByChannel.set(makeKey(m.chain, m.hub_channel), m);
  }

  const buckets = new Map<string, ChannelBuckets>();
  const getBuckets = (key: string): ChannelBuckets => {
    let b = buckets.get(key);
    if (!b) {
      b = newBuckets();
      buckets.set(key, b);
    }
    return b;
  };
  for (const r of agg24h) {
    if (r.hub_channel === null) continue;
    fillBucket(getBuckets(makeKey(r.chain, r.hub_channel))['24h'], r);
  }
  for (const r of agg7d) {
    if (r.hub_channel === null) continue;
    fillBucket(getBuckets(makeKey(r.chain, r.hub_channel))['7d'], r);
  }
  for (const r of agg30d) {
    if (r.hub_channel === null) continue;
    fillBucket(getBuckets(makeKey(r.chain, r.hub_channel))['30d'], r);
  }

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
    if (r.hub_channel === null) continue;
    const channelKey = makeKey(r.chain, r.hub_channel);
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

  const dtos: ChannelDto[] = hubChannels.map((h) => {
    const key = makeKey(h.chain, h.channel_id_src);
    const m = metaByChannel.get(key);
    const b = buckets.get(key) ?? newBuckets();
    const delivered = m ? Number(m.delivered_30d) : 0;
    const failed = m ? Number(m.failed_30d) : 0;
    const denom = delivered + failed;
    return {
      chain: h.chain as ChainName,
      channel_id_src: h.channel_id_src,
      port_id_src: h.port_id_src,
      channel_id_dst: h.counterparty_channel_id,
      counterparty_chain_id: h.counterparty_chain_id,
      counterparty_chain_name: h.counterparty_chain_name,
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
      last_activity:
        m && m.last_activity !== null ? m.last_activity.toISOString() : null,
      denoms: denomsByChannel.get(key) ?? [],
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
