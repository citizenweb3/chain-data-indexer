import { Prisma } from '@prisma/client';

import { db } from '@/db';
import { CHAIN_NAMES, getChainMetadata, type ChainMetadata, type ChainName } from '@/lib/chains';
import type {
  IbcAggregationFreshness,
  IbcCoverageQuality,
  IbcCoverageStatus,
} from '@/schemas/ibc-aggregation';
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
import { formatNative } from '@/utils/format-amount';

export type StatsDirection = 'outgoing' | 'incoming' | 'both';

export type StatsWindowCounts = { '24h': number; '7d': number; '30d': number };
export type StatsWindowAmounts = { '24h': string; '7d': string; '30d': string };
export type StatsWindowCoverage = {
  '24h': IbcCoverageStatus;
  '7d': IbcCoverageStatus;
  '30d': IbcCoverageStatus;
};

type StatsBaseResult = IbcAggregationFreshness & {
  transfers_count: StatsWindowCounts;
  volume_atom: StatsWindowAmounts;
  volume_usd: StatsWindowAmounts;
  coverage: StatsWindowCoverage;
  as_of: string;
};

type StatsNativeResult = {
  volume_native: StatsWindowAmounts;
  native_denom: string;
  native_symbol: string;
  native_decimals: number;
};

export type StatsPerChainRow = StatsNativeResult & {
  chain: ChainName;
  transfers_count: StatsWindowCounts;
  volume_atom: StatsWindowAmounts;
  volume_usd: StatsWindowAmounts;
  coverage: StatsWindowCoverage;
};

export type StatsCombinedResult = StatsBaseResult & {
  per_chain?: StatsPerChainRow[];
};

export type StatsChainResult = StatsBaseResult &
  StatsNativeResult & {
    per_chain?: never;
  };
export type StatsResult = StatsCombinedResult | StatsChainResult;
type StatsResultFor<TChain extends ChainName | null> = TChain extends ChainName
  ? StatsChainResult
  : StatsCombinedResult;

const ATOM_METADATA = getChainMetadata('cosmoshub');
const MS_PER_DAY = 86_400_000;

const todayUtcMidnight = (now: Date): Date => {
  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);
  return date;
};

const packetDirectionFilter = (direction: StatsDirection): Prisma.Sql =>
  direction === 'both'
    ? Prisma.sql`p.direction IN ('outgoing','incoming')`
    : Prisma.sql`p.direction = ${direction}`;

const dailyDirectionFilter = (direction: StatsDirection): Prisma.Sql =>
  direction === 'both'
    ? Prisma.sql`direction IN ('outgoing','incoming')`
    : Prisma.sql`direction = ${direction}`;

const chainFilterSql = (chain: ChainName | null): Prisma.Sql =>
  chain ? Prisma.sql`AND chain = ${chain}` : Prisma.empty;

type AggregateWindowRow = IbcCoverageCountRow & {
  transfers_count: bigint;
  amount_atom: Prisma.Decimal | null;
  amount_native: Prisma.Decimal | null;
  amount_usd: Prisma.Decimal | null;
};

const emptyAggregateWindow = (): AggregateWindowRow => ({
  transfers_count: BigInt(0),
  amount_atom: null,
  amount_native: null,
  amount_usd: null,
  eligible_packets: BigInt(0),
  priced_packets: BigInt(0),
  unpriced_packets: BigInt(0),
  unpriced_denoms: [],
});

const queryPacketsWindow = async (
  direction: StatsDirection,
  fromTime: Date,
  chain: ChainName | null,
  nativeDenom: string,
): Promise<AggregateWindowRow> => {
  const rows = await db.$queryRaw<AggregateWindowRow[]>(Prisma.sql`
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
        CASE WHEN ${RESOLVED_PACKET_DENOM_SQL} = ${ATOM_METADATA.nativeDenom} THEN p.amount END
      ), 0) AS amount_atom,
      COALESCE(SUM(
        CASE WHEN ${RESOLVED_PACKET_DENOM_SQL} = ${nativeDenom} THEN p.amount END
      ), 0) AS amount_native,
      COALESCE(SUM(
        CASE WHEN ${PRICED_PACKET_SQL}
          THEN (p.amount / POWER(10::numeric, a.decimals)) * COALESCE(ph.usd, dsp.usd)
        END
      ), 0) AS amount_usd,
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
  return rows[0] ?? emptyAggregateWindow();
};

const queryDailyWindow = async (
  direction: StatsDirection,
  fromDate: Date,
  toDateExclusive: Date,
  chain: ChainName | null,
  nativeDenom: string,
): Promise<AggregateWindowRow> => {
  const rows = await db.$queryRaw<AggregateWindowRow[]>(Prisma.sql`
    WITH count_rows AS (
      SELECT *
      FROM ibc_daily_stats
      WHERE channel_id_src IS NULL
        AND denom IS NULL
        AND date >= ${fromDate}
        AND date < ${toDateExclusive}
        AND ${dailyDirectionFilter(direction)}
        ${chainFilterSql(chain)}
    ),
    volume_rows AS (
      SELECT *
      FROM ibc_daily_stats
      WHERE channel_id_src IS NULL
        AND denom IS NOT NULL
        AND date >= ${fromDate}
        AND date < ${toDateExclusive}
        AND ${dailyDirectionFilter(direction)}
        ${chainFilterSql(chain)}
    )
    SELECT
      COALESCE((SELECT SUM(transfers_count) FROM count_rows), 0)::bigint
        AS transfers_count,
      COALESCE((SELECT SUM(amount_native) FROM volume_rows WHERE denom = ${ATOM_METADATA.nativeDenom}), 0)
        AS amount_atom,
      COALESCE((SELECT SUM(amount_native) FROM volume_rows WHERE denom = ${nativeDenom}), 0)
        AS amount_native,
      COALESCE((SELECT SUM(amount_usd) FROM volume_rows), 0)
        AS amount_usd,
      ${dailyCoverageSelectSql()}
    FROM count_rows d
  `);
  return rows[0] ?? emptyAggregateWindow();
};

const addDecimal = (
  left: Prisma.Decimal | null,
  right: Prisma.Decimal | null,
): Prisma.Decimal | null => {
  if (left === null && right === null) return null;
  return (left ?? new Prisma.Decimal(0)).add(right ?? new Prisma.Decimal(0));
};

const formatAmount = (value: Prisma.Decimal | null, decimals: number): string =>
  formatNative(value?.toFixed(0) ?? '0', decimals) ?? '0';

const formatUsd = (value: Prisma.Decimal | null): string =>
  value === null ? '0' : value.toFixed(2);

type StatsWindowRows = {
  last24Hours: AggregateWindowRow;
  today: AggregateWindowRow;
  daily7Days: AggregateWindowRow;
  daily30Days: AggregateWindowRow;
};

const queryStatsWindows = async (
  direction: StatsDirection,
  chain: ChainName | null,
  nativeDenom: string,
  now: Date,
): Promise<StatsWindowRows> => {
  const midnight = todayUtcMidnight(now);
  const window24hStart = new Date(now.getTime() - MS_PER_DAY);
  const window7dDailyFrom = new Date(midnight.getTime() - 6 * MS_PER_DAY);
  const window30dDailyFrom = new Date(midnight.getTime() - 29 * MS_PER_DAY);

  const [last24Hours, today, daily7Days, daily30Days] = await Promise.all([
    queryPacketsWindow(direction, window24hStart, chain, nativeDenom),
    queryPacketsWindow(direction, midnight, chain, nativeDenom),
    queryDailyWindow(direction, window7dDailyFrom, midnight, chain, nativeDenom),
    queryDailyWindow(direction, window30dDailyFrom, midnight, chain, nativeDenom),
  ]);
  return { last24Hours, today, daily7Days, daily30Days };
};

const hybridCoverageStatus = (
  dailyQuality: IbcCoverageQuality,
  daily: AggregateWindowRow,
  today: AggregateWindowRow,
): IbcCoverageStatus => {
  const quality = combineIbcCoverageQualities([dailyQuality, 'corrected']);
  if (quality !== 'corrected') return toIbcCoverageStatus(quality);
  return toIbcCoverageStatus('corrected', mergeIbcCoverageRows([daily, today]));
};

const buildWindowCoverage = (
  rows: StatsWindowRows,
  sourceStates: readonly IbcSourceState[],
  now: Date,
): StatsWindowCoverage => {
  const midnight = todayUtcMidnight(now);
  const window7dDailyFrom = new Date(midnight.getTime() - 6 * MS_PER_DAY);
  const window30dDailyFrom = new Date(midnight.getTime() - 29 * MS_PER_DAY);

  return {
    '24h': toIbcCoverageStatus('corrected', mergeIbcCoverageRows([rows.last24Hours])),
    '7d': hybridCoverageStatus(
      classifyIbcDailyRange(window7dDailyFrom, midnight, sourceStates),
      rows.daily7Days,
      rows.today,
    ),
    '30d': hybridCoverageStatus(
      classifyIbcDailyRange(window30dDailyFrom, midnight, sourceStates),
      rows.daily30Days,
      rows.today,
    ),
  };
};

const buildBaseStats = (
  rows: StatsWindowRows,
  sourceStates: readonly IbcSourceState[],
  freshness: IbcAggregationFreshness,
  now: Date,
): StatsBaseResult => {
  const transfersToday = Number(rows.today.transfers_count);
  const amountAtom7d = addDecimal(rows.daily7Days.amount_atom, rows.today.amount_atom);
  const amountAtom30d = addDecimal(rows.daily30Days.amount_atom, rows.today.amount_atom);
  const amountUsd7d = addDecimal(rows.daily7Days.amount_usd, rows.today.amount_usd);
  const amountUsd30d = addDecimal(rows.daily30Days.amount_usd, rows.today.amount_usd);

  return {
    transfers_count: {
      '24h': Number(rows.last24Hours.transfers_count),
      '7d': Number(rows.daily7Days.transfers_count) + transfersToday,
      '30d': Number(rows.daily30Days.transfers_count) + transfersToday,
    },
    volume_atom: {
      '24h': formatAmount(rows.last24Hours.amount_atom, ATOM_METADATA.nativeDecimals),
      '7d': formatAmount(amountAtom7d, ATOM_METADATA.nativeDecimals),
      '30d': formatAmount(amountAtom30d, ATOM_METADATA.nativeDecimals),
    },
    volume_usd: {
      '24h': formatUsd(rows.last24Hours.amount_usd),
      '7d': formatUsd(amountUsd7d),
      '30d': formatUsd(amountUsd30d),
    },
    coverage: buildWindowCoverage(rows, sourceStates, now),
    as_of: freshness.generated_at,
    ...freshness,
  };
};

const buildPerChainRow = (
  chain: ChainName,
  rows: StatsWindowRows,
  sourceStates: readonly IbcSourceState[],
  now: Date,
): StatsPerChainRow => {
  const metadata = getChainMetadata(chain);
  const generatedAt = now.toISOString();
  const base = buildBaseStats(rows, sourceStates, { generated_at: generatedAt, sources: [] }, now);
  return {
    chain,
    transfers_count: base.transfers_count,
    volume_atom: base.volume_atom,
    volume_native: {
      '24h': formatAmount(rows.last24Hours.amount_native, metadata.nativeDecimals),
      '7d': formatAmount(
        addDecimal(rows.daily7Days.amount_native, rows.today.amount_native),
        metadata.nativeDecimals,
      ),
      '30d': formatAmount(
        addDecimal(rows.daily30Days.amount_native, rows.today.amount_native),
        metadata.nativeDecimals,
      ),
    },
    volume_usd: base.volume_usd,
    coverage: base.coverage,
    native_denom: metadata.nativeDenom,
    native_symbol: metadata.nativeSymbol,
    native_decimals: metadata.nativeDecimals,
  };
};

const nativeMetadataFields = (metadata: ChainMetadata) => ({
  native_denom: metadata.nativeDenom,
  native_symbol: metadata.nativeSymbol,
  native_decimals: metadata.nativeDecimals,
});

export const getStats = async <TChain extends ChainName | null>(params: {
  direction: StatsDirection;
  chain: TChain;
  breakdown?: 'chain';
}): Promise<StatsResultFor<TChain>> => {
  const now = new Date();
  const nativeMetadata = params.chain ? getChainMetadata(params.chain) : null;
  const nativeDenom = nativeMetadata?.nativeDenom ?? ATOM_METADATA.nativeDenom;
  const [rows, context] = await Promise.all([
    queryStatsWindows(params.direction, params.chain, nativeDenom, now),
    getIbcAggregationContext(params.chain, now),
  ]);
  const base = buildBaseStats(rows, context.sourceStates, context.freshness, now);

  if (params.chain) {
    const metadata = getChainMetadata(params.chain);
    return {
      ...base,
      volume_native: {
        '24h': formatAmount(rows.last24Hours.amount_native, metadata.nativeDecimals),
        '7d': formatAmount(
          addDecimal(rows.daily7Days.amount_native, rows.today.amount_native),
          metadata.nativeDecimals,
        ),
        '30d': formatAmount(
          addDecimal(rows.daily30Days.amount_native, rows.today.amount_native),
          metadata.nativeDecimals,
        ),
      },
      ...nativeMetadataFields(metadata),
    } as StatsResultFor<TChain>;
  }

  const combined: StatsCombinedResult = {
    transfers_count: base.transfers_count,
    volume_atom: base.volume_atom,
    volume_usd: base.volume_usd,
    coverage: base.coverage,
    as_of: base.as_of,
    generated_at: base.generated_at,
    sources: base.sources,
  };
  if (params.breakdown !== 'chain') {
    return combined as StatsResultFor<TChain>;
  }

  const perChainRows = await Promise.all(
    CHAIN_NAMES.map(async (chain) => {
      const metadata = getChainMetadata(chain);
      const chainRows = await queryStatsWindows(params.direction, chain, metadata.nativeDenom, now);
      const sourceStates = context.sourceStates.filter((state) => state.chain === chain);
      return buildPerChainRow(chain, chainRows, sourceStates, now);
    }),
  );

  return { ...combined, per_chain: perChainRows } as StatsResultFor<TChain>;
};
