import { Prisma } from '@prisma/client';

import { db } from '@/db';
import { getChainMetadata, type ChainName } from '@/lib/chains';
import type { IbcAggregationFreshness, IbcCoverageStatus } from '@/schemas/ibc-aggregation';
import {
  mergeIbcCoverageRows,
  toIbcCoverageStatus,
  type IbcCoverageCountRow,
  type IbcCoverageCounts,
} from '@/services/ibc-aggregation-coverage';
import {
  DELIVERED_PACKET_SQL,
  PRICED_PACKET_SQL,
  RESOLVED_PACKET_DENOM_SQL,
} from '@/services/ibc-aggregation-sql';
import { getIbcAggregationContext } from '@/services/ibc-aggregation-state';
import { formatNative } from '@/utils/format-amount';
import { formatDenomDisplay } from '@/utils/format-denom';

export type ChannelsDirection = 'outgoing' | 'incoming' | 'both';
export type ChannelsPeriod = '24h' | '7d' | '30d';
export type ChannelsCombinedSort = 'transfers' | 'volume_atom' | 'volume_usd' | 'last_activity';
export type ChannelsSort = ChannelsCombinedSort | 'volume_native';
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

type PeriodCounts = { '24h': number; '7d': number; '30d': number };
type PeriodAmounts = { '24h': string; '7d': string; '30d': string };
type PeriodCoverage = {
  '24h': IbcCoverageStatus;
  '7d': IbcCoverageStatus;
  '30d': IbcCoverageStatus;
};

type ChannelBaseDto = {
  chain: ChainName;
  channel_id_src: string;
  port_id_src: string;
  channel_id_dst: string | null;
  counterparty_chain_id: string | null;
  counterparty_chain_name: string | null;
  transfers: PeriodCounts;
  volume_atom: PeriodAmounts;
  volume_usd: PeriodAmounts;
  coverage: PeriodCoverage;
  success_rate_30d: number | null;
  last_activity: string | null;
  denoms: ChannelDenom[];
};

export type ChannelCombinedDto = ChannelBaseDto & { volume_native?: never };
export type ChannelChainDto = ChannelBaseDto & {
  volume_native: PeriodAmounts;
  native_denom: string;
  native_symbol: string;
  native_decimals: number;
};
export type ChannelDto = ChannelCombinedDto | ChannelChainDto;

type ChannelsResultBase = IbcAggregationFreshness & {
  page: { total: number; limit: number; offset: number };
};
export type ChannelsCombinedResult = ChannelsResultBase & {
  data: ChannelCombinedDto[];
};
export type ChannelsChainResult = ChannelsResultBase & {
  data: ChannelChainDto[];
};
export type ChannelsResult = ChannelsCombinedResult | ChannelsChainResult;
type ChannelsResultFor<TChain extends ChainName | null> = TChain extends ChainName
  ? ChannelsChainResult
  : ChannelsCombinedResult;

const ATOM_DENOM = 'uatom';
const ATOM_DECIMALS = 6;
const MS_PER_DAY = 86_400_000;
const TOP_DENOMS_PER_CHANNEL = 3;

const directionFilter = (direction: ChannelsDirection): Prisma.Sql =>
  direction === 'both'
    ? Prisma.sql`p.direction IN ('outgoing','incoming')`
    : Prisma.sql`p.direction = ${direction}`;

const chainFilter = (chain: ChainName | null): Prisma.Sql =>
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

const queryHubChannels = async (chain: ChainName | null): Promise<HubChannelRow[]> =>
  db.$queryRaw<HubChannelRow[]>(Prisma.sql`
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
): Promise<ChannelMetaRow[]> =>
  db.$queryRaw<ChannelMetaRow[]>(Prisma.sql`
    SELECT
      p.chain AS chain,
      ${hubChannelExpr} AS hub_channel,
      MAX(p.event_time) AS last_activity,
      COUNT(*) FILTER (WHERE ${DELIVERED_PACKET_SQL})::bigint AS delivered_30d,
      COUNT(*) FILTER (WHERE p.status IN ('timeout','failed'))::bigint AS failed_30d
    FROM ibc_packets p
    WHERE p.event_time IS NOT NULL
      AND p.event_time >= ${thirtyDaysAgo}
      AND ${directionFilter(direction)}
      ${chainFilter(chain)}
    GROUP BY p.chain, hub_channel
  `);

type WindowAggregateRow = IbcCoverageCountRow & {
  chain: string;
  hub_channel: string | null;
  transfers_count: bigint;
  amount_atom: Prisma.Decimal | null;
  amount_native: Prisma.Decimal | null;
  amount_usd: Prisma.Decimal | null;
};

const queryWindowAggregates = async (
  direction: ChannelsDirection,
  fromTime: Date,
  chain: ChainName | null,
  nativeDenom: string,
): Promise<WindowAggregateRow[]> => {
  const spotFrom = new Date(fromTime.getTime() - MS_PER_DAY);
  return db.$queryRaw<WindowAggregateRow[]>(Prisma.sql`
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
      COALESCE(SUM(
        CASE WHEN ${RESOLVED_PACKET_DENOM_SQL} = ${ATOM_DENOM} THEN p.amount END
      ), 0) AS amount_atom,
      COALESCE(SUM(
        CASE WHEN ${RESOLVED_PACKET_DENOM_SQL} = ${nativeDenom} THEN p.amount END
      ), 0) AS amount_native,
      COALESCE(SUM(
        CASE WHEN ${PRICED_PACKET_SQL}
          THEN (p.amount / POWER(10::numeric, a.decimals)) * COALESCE(ph.usd, dsp.usd)
        END
      ), 0) AS amount_usd,
      COUNT(*)::bigint AS eligible_packets,
      COUNT(*) FILTER (WHERE ${PRICED_PACKET_SQL})::bigint AS priced_packets,
      COUNT(*) FILTER (WHERE NOT ${PRICED_PACKET_SQL})::bigint AS unpriced_packets,
      COALESCE(
        ARRAY_AGG(DISTINCT ${RESOLVED_PACKET_DENOM_SQL})
          FILTER (WHERE NOT ${PRICED_PACKET_SQL}),
        ARRAY[]::text[]
      ) AS unpriced_denoms
    FROM ibc_packets p
    LEFT JOIN assets a ON a.native_denom = ${RESOLVED_PACKET_DENOM_SQL}
    LEFT JOIN price_history ph ON ph.asset_id = a.id
      AND ph.date = (p.event_time AT TIME ZONE 'UTC')::date
    LEFT JOIN daily_spot_prices dsp ON dsp.asset_id = a.id
      AND dsp.date = (p.event_time AT TIME ZONE 'UTC')::date
    WHERE p.event_time IS NOT NULL
      AND p.event_time >= ${fromTime}
      AND ${directionFilter(direction)}
      ${chainFilter(chain)}
      AND ${DELIVERED_PACKET_SQL}
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

const queryChannelDenoms = async (
  direction: ChannelsDirection,
  thirtyDaysAgo: Date,
  chain: ChainName | null,
): Promise<ChannelDenomRow[]> =>
  db.$queryRaw<ChannelDenomRow[]>(Prisma.sql`
    WITH daily_spot_prices AS (
      SELECT DISTINCT ON (asset_id, date)
        asset_id,
        (created_at AT TIME ZONE 'UTC')::date AS date,
        usd
      FROM prices
      ORDER BY asset_id, (created_at AT TIME ZONE 'UTC')::date, created_at DESC
    ),
    resolved_packets AS (
      SELECT p.*, ${RESOLVED_PACKET_DENOM_SQL} AS base_denom
      FROM ibc_packets p
      WHERE p.event_time IS NOT NULL
        AND p.event_time >= ${thirtyDaysAgo}
        AND p.denom IS NOT NULL
        AND ${directionFilter(direction)}
        ${chainFilter(chain)}
        AND ${DELIVERED_PACKET_SQL}
    )
    SELECT
      p.chain AS chain,
      ${hubChannelExpr} AS hub_channel,
      p.base_denom,
      p.denom AS raw_denom,
      a.symbol AS symbol,
      a.decimals AS decimals,
      COUNT(*)::bigint AS count,
      COALESCE(SUM(p.amount), 0) AS amount_native,
      COALESCE(SUM(
        CASE WHEN ${PRICED_PACKET_SQL}
          THEN (p.amount / POWER(10::numeric, a.decimals)) * COALESCE(ph.usd, dsp.usd)
        END
      ), 0) AS amount_usd
    FROM resolved_packets p
    LEFT JOIN assets a ON a.native_denom = p.base_denom
    LEFT JOIN price_history ph ON ph.asset_id = a.id
      AND ph.date = (p.event_time AT TIME ZONE 'UTC')::date
    LEFT JOIN daily_spot_prices dsp ON dsp.asset_id = a.id
      AND dsp.date = (p.event_time AT TIME ZONE 'UTC')::date
    GROUP BY
      p.chain,
      hub_channel,
      p.base_denom,
      p.denom,
      a.symbol,
      a.decimals
  `);

type Bucket = {
  count: number;
  atom: Prisma.Decimal;
  native: Prisma.Decimal;
  usd: Prisma.Decimal;
  coverage: IbcCoverageCounts;
};
type ChannelBuckets = { '24h': Bucket; '7d': Bucket; '30d': Bucket };

const newBucket = (): Bucket => ({
  count: 0,
  atom: new Prisma.Decimal(0),
  native: new Prisma.Decimal(0),
  usd: new Prisma.Decimal(0),
  coverage: mergeIbcCoverageRows([]),
});

const newBuckets = (): ChannelBuckets => ({
  '24h': newBucket(),
  '7d': newBucket(),
  '30d': newBucket(),
});

const fillBucket = (bucket: Bucket, row: WindowAggregateRow): void => {
  bucket.count = Number(row.transfers_count);
  bucket.atom = row.amount_atom ?? new Prisma.Decimal(0);
  bucket.native = row.amount_native ?? new Prisma.Decimal(0);
  bucket.usd = row.amount_usd ?? new Prisma.Decimal(0);
  bucket.coverage = mergeIbcCoverageRows([row]);
};

const formatAmount = (value: Prisma.Decimal, decimals: number): string =>
  formatNative(value.toFixed(0), decimals) ?? '0';

const formatUsd = (value: Prisma.Decimal): string => value.toFixed(2);

type InternalChannelDto = ChannelBaseDto & {
  volume_native: PeriodAmounts;
  native_denom: string;
  native_symbol: string;
  native_decimals: number;
};

const compareDto = (sort: ChannelsSort, order: SortOrder, period: ChannelsPeriod) => {
  const direction = order === 'asc' ? 1 : -1;
  return (left: InternalChannelDto, right: InternalChannelDto): number => {
    if (sort === 'transfers') {
      return (left.transfers[period] - right.transfers[period]) * direction;
    }
    if (sort === 'volume_atom') {
      return (Number(left.volume_atom[period]) - Number(right.volume_atom[period])) * direction;
    }
    if (sort === 'volume_native') {
      return (Number(left.volume_native[period]) - Number(right.volume_native[period])) * direction;
    }
    if (sort === 'volume_usd') {
      return (Number(left.volume_usd[period]) - Number(right.volume_usd[period])) * direction;
    }
    const leftTime = left.last_activity ? new Date(left.last_activity).getTime() : 0;
    const rightTime = right.last_activity ? new Date(right.last_activity).getTime() : 0;
    return (leftTime - rightTime) * direction;
  };
};

const makeKey = (chain: string, hubChannel: string): string => `${chain}::${hubChannel}`;

const toCombinedDto = (dto: InternalChannelDto): ChannelCombinedDto => ({
  chain: dto.chain,
  channel_id_src: dto.channel_id_src,
  port_id_src: dto.port_id_src,
  channel_id_dst: dto.channel_id_dst,
  counterparty_chain_id: dto.counterparty_chain_id,
  counterparty_chain_name: dto.counterparty_chain_name,
  transfers: dto.transfers,
  volume_atom: dto.volume_atom,
  volume_usd: dto.volume_usd,
  coverage: dto.coverage,
  success_rate_30d: dto.success_rate_30d,
  last_activity: dto.last_activity,
  denoms: dto.denoms,
});

export const listChannels = async <TChain extends ChainName | null>(params: {
  direction: ChannelsDirection;
  period: ChannelsPeriod;
  sort: ChannelsSort;
  order: SortOrder;
  limit: number;
  offset: number;
  chain: TChain;
}): Promise<ChannelsResultFor<TChain>> => {
  if (params.chain === null && params.sort === 'volume_native') {
    throw new Error('volume_native sorting requires a chain-scoped channels request');
  }

  const now = new Date();
  const midnight = new Date(now);
  midnight.setUTCHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(midnight.getTime() - 29 * MS_PER_DAY);
  const sevenDaysAgo = new Date(midnight.getTime() - 6 * MS_PER_DAY);
  const window24hStart = new Date(now.getTime() - MS_PER_DAY);
  const nativeDenom = params.chain ? getChainMetadata(params.chain).nativeDenom : ATOM_DENOM;

  const [hubChannels, meta, agg24h, agg7d, agg30d, denomRows, context] = await Promise.all([
    queryHubChannels(params.chain),
    queryChannelsMeta(params.direction, thirtyDaysAgo, params.chain),
    queryWindowAggregates(params.direction, window24hStart, params.chain, nativeDenom),
    queryWindowAggregates(params.direction, sevenDaysAgo, params.chain, nativeDenom),
    queryWindowAggregates(params.direction, thirtyDaysAgo, params.chain, nativeDenom),
    queryChannelDenoms(params.direction, thirtyDaysAgo, params.chain),
    getIbcAggregationContext(params.chain, now),
  ]);

  const metaByChannel = new Map<string, ChannelMetaRow>();
  for (const row of meta) {
    if (row.hub_channel === null) continue;
    metaByChannel.set(makeKey(row.chain, row.hub_channel), row);
  }

  const buckets = new Map<string, ChannelBuckets>();
  const getBuckets = (key: string): ChannelBuckets => {
    const existing = buckets.get(key);
    if (existing) return existing;
    const created = newBuckets();
    buckets.set(key, created);
    return created;
  };
  for (const row of agg24h) {
    if (row.hub_channel === null) continue;
    fillBucket(getBuckets(makeKey(row.chain, row.hub_channel))['24h'], row);
  }
  for (const row of agg7d) {
    if (row.hub_channel === null) continue;
    fillBucket(getBuckets(makeKey(row.chain, row.hub_channel))['7d'], row);
  }
  for (const row of agg30d) {
    if (row.hub_channel === null) continue;
    fillBucket(getBuckets(makeKey(row.chain, row.hub_channel))['30d'], row);
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
  for (const row of denomRows) {
    if (row.hub_channel === null) continue;
    const channelKey = makeKey(row.chain, row.hub_channel);
    const aggregate = denomsAggByChannel.get(channelKey) ?? new Map<string, DenomEntry>();
    const entry = aggregate.get(row.base_denom) ?? {
      symbol: row.symbol,
      decimals: row.decimals,
      count: 0,
      amount_native: new Prisma.Decimal(0),
      amount_usd: new Prisma.Decimal(0),
      raws: new Set<string>(),
    };
    if (entry.symbol === null && row.symbol !== null) entry.symbol = row.symbol;
    if (entry.decimals === null && row.decimals !== null) {
      entry.decimals = row.decimals;
    }
    entry.count += Number(row.count);
    if (row.amount_native !== null) {
      entry.amount_native = entry.amount_native.add(row.amount_native);
    }
    if (row.amount_usd !== null) {
      entry.amount_usd = entry.amount_usd.add(row.amount_usd);
    }
    if (row.raw_denom) entry.raws.add(row.raw_denom);
    aggregate.set(row.base_denom, entry);
    denomsAggByChannel.set(channelKey, aggregate);
  }

  const denomsByChannel = new Map<string, ChannelDenom[]>();
  for (const [channelKey, aggregate] of denomsAggByChannel) {
    const sorted = [...aggregate.entries()]
      .map(([baseDenom, entry]) => ({
        display: formatDenomDisplay(baseDenom, entry.symbol),
        native_denom: baseDenom,
        symbol: entry.symbol,
        decimals: entry.decimals,
        count: entry.count,
        amount_native: entry.amount_native.toFixed(0),
        amount_usd: entry.amount_usd.toFixed(2),
        raws: [...entry.raws].sort(),
      }))
      .sort((left, right) => {
        const usdComparison = Number(right.amount_usd) - Number(left.amount_usd);
        if (usdComparison !== 0) return usdComparison;
        return right.count - left.count;
      })
      .slice(0, TOP_DENOMS_PER_CHANNEL);
    denomsByChannel.set(channelKey, sorted);
  }

  const dtos: InternalChannelDto[] = hubChannels.map((hub) => {
    const chain = hub.chain as ChainName;
    const metadata = getChainMetadata(chain);
    const key = makeKey(hub.chain, hub.channel_id_src);
    const channelMeta = metaByChannel.get(key);
    const channelBuckets = buckets.get(key) ?? newBuckets();
    const delivered = channelMeta ? Number(channelMeta.delivered_30d) : 0;
    const failed = channelMeta ? Number(channelMeta.failed_30d) : 0;
    const completed = delivered + failed;
    return {
      chain,
      channel_id_src: hub.channel_id_src,
      port_id_src: hub.port_id_src,
      channel_id_dst: hub.counterparty_channel_id,
      counterparty_chain_id: hub.counterparty_chain_id,
      counterparty_chain_name: hub.counterparty_chain_name,
      transfers: {
        '24h': channelBuckets['24h'].count,
        '7d': channelBuckets['7d'].count,
        '30d': channelBuckets['30d'].count,
      },
      volume_atom: {
        '24h': formatAmount(channelBuckets['24h'].atom, ATOM_DECIMALS),
        '7d': formatAmount(channelBuckets['7d'].atom, ATOM_DECIMALS),
        '30d': formatAmount(channelBuckets['30d'].atom, ATOM_DECIMALS),
      },
      volume_native: {
        '24h': formatAmount(channelBuckets['24h'].native, metadata.nativeDecimals),
        '7d': formatAmount(channelBuckets['7d'].native, metadata.nativeDecimals),
        '30d': formatAmount(channelBuckets['30d'].native, metadata.nativeDecimals),
      },
      volume_usd: {
        '24h': formatUsd(channelBuckets['24h'].usd),
        '7d': formatUsd(channelBuckets['7d'].usd),
        '30d': formatUsd(channelBuckets['30d'].usd),
      },
      coverage: {
        '24h': toIbcCoverageStatus('corrected', channelBuckets['24h'].coverage),
        '7d': toIbcCoverageStatus('corrected', channelBuckets['7d'].coverage),
        '30d': toIbcCoverageStatus('corrected', channelBuckets['30d'].coverage),
      },
      native_denom: metadata.nativeDenom,
      native_symbol: metadata.nativeSymbol,
      native_decimals: metadata.nativeDecimals,
      success_rate_30d: completed > 0 ? delivered / completed : null,
      last_activity: channelMeta?.last_activity?.toISOString() ?? null,
      denoms: denomsByChannel.get(key) ?? [],
    };
  });

  dtos.sort(compareDto(params.sort, params.order, params.period));
  const total = dtos.length;
  const sliced = dtos.slice(params.offset, params.offset + params.limit);
  return {
    data: params.chain ? sliced : sliced.map(toCombinedDto),
    page: { total, limit: params.limit, offset: params.offset },
    ...context.freshness,
  } as ChannelsResultFor<TChain>;
};
