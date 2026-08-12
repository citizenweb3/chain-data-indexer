import { Prisma } from '@prisma/client';

import { db } from '@/db';
import { CHAIN_NAMES, type ChainName } from '@/lib/chains';
import type { IbcAggregationFreshness, IbcCoverageQuality } from '@/schemas/ibc-aggregation';

const SYNC_HEARTBEAT_KEY = 'sync-ibc-transfers';

export type IbcSourceState = {
  chain: ChainName;
  aggregateVersion: number | null;
  correctedFrom: Date | null;
};

export type IbcAggregationContext = {
  freshness: IbcAggregationFreshness;
  sourceStates: IbcSourceState[];
};

type PacketWatermarkRow = {
  chain: string;
  latest_source_event_at: Date | null;
};

const formatYmd = (date: Date): string => date.toISOString().slice(0, 10);

export const getIbcAggregationContext = async (
  chain: ChainName | null,
  generatedAt: Date,
): Promise<IbcAggregationContext> => {
  const chains = chain ? [chain] : [...CHAIN_NAMES];
  const [states, syncCursors, packetWatermarks] = await Promise.all([
    db.ibcAggregateState.findMany({
      where: { chain: { in: chains } },
      select: {
        chain: true,
        version: true,
        correctedFrom: true,
        lastRecomputedAt: true,
      },
    }),
    db.syncCursor.findMany({
      where: { chain: { in: chains }, key: SYNC_HEARTBEAT_KEY },
      select: { chain: true, updatedAt: true },
    }),
    db.$queryRaw<PacketWatermarkRow[]>(Prisma.sql`
      SELECT chain, MAX(event_time) AS latest_source_event_at
      FROM ibc_packets
      WHERE chain IN (${Prisma.join(chains)})
      GROUP BY chain
    `),
  ]);

  const stateByChain = new Map(states.map((state) => [state.chain, state]));
  const syncByChain = new Map(syncCursors.map((cursor) => [cursor.chain, cursor]));
  const packetByChain = new Map(packetWatermarks.map((row) => [row.chain, row]));

  const sourceStates = chains.map<IbcSourceState>((name) => {
    const state = stateByChain.get(name);
    return {
      chain: name,
      aggregateVersion: state?.version ?? null,
      correctedFrom: state?.correctedFrom ?? null,
    };
  });

  return {
    sourceStates,
    freshness: {
      generated_at: generatedAt.toISOString(),
      sources: chains.map((name) => {
        const state = stateByChain.get(name);
        return {
          chain: name,
          corrected_from: state?.correctedFrom ? formatYmd(state.correctedFrom) : null,
          last_successful_sync_at: syncByChain.get(name)?.updatedAt.toISOString() ?? null,
          last_recomputed_at: state?.lastRecomputedAt?.toISOString() ?? null,
          latest_source_event_at:
            packetByChain.get(name)?.latest_source_event_at?.toISOString() ?? null,
        };
      }),
    },
  };
};

export const classifyIbcDailyRange = (
  fromInclusive: Date,
  toExclusive: Date,
  sourceStates: readonly IbcSourceState[],
): IbcCoverageQuality => {
  let hasCorrected = false;
  let hasLegacy = false;

  for (const source of sourceStates) {
    const correctedFrom = source.correctedFrom;
    if (correctedFrom === null || toExclusive.getTime() <= correctedFrom.getTime()) {
      hasLegacy = true;
      continue;
    }
    if (fromInclusive.getTime() >= correctedFrom.getTime()) {
      hasCorrected = true;
      continue;
    }
    hasCorrected = true;
    hasLegacy = true;
  }

  if (hasCorrected && hasLegacy) return 'mixed';
  if (hasCorrected) return 'corrected';
  return 'legacy_unverified';
};

export const combineIbcCoverageQualities = (
  qualities: readonly IbcCoverageQuality[],
): IbcCoverageQuality => {
  if (qualities.length === 0) return 'legacy_unverified';
  if (qualities.every((quality) => quality === 'corrected')) return 'corrected';
  if (qualities.every((quality) => quality === 'legacy_unverified')) {
    return 'legacy_unverified';
  }
  return 'mixed';
};
