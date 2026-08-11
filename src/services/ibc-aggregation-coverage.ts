import type {
  IbcCoverageQuality,
  IbcCoverageStatus,
  IbcPacketCoverage,
} from '@/schemas/ibc-aggregation';
import { UNKNOWN_IBC_DENOM } from '@/services/ibc-aggregation-sql';

export type IbcCoverageCountRow = {
  eligible_packets: bigint | null;
  priced_packets: bigint | null;
  unpriced_packets: bigint | null;
  unpriced_denoms: readonly string[] | null;
};

export type IbcCoverageCounts = {
  eligiblePackets: bigint;
  pricedPackets: bigint;
  unpricedPackets: bigint;
  unpricedDenoms: readonly string[];
};

export const normalizeUnpricedDenom = (denom: string | null): string => denom ?? UNKNOWN_IBC_DENOM;

const toSafeCount = (value: bigint, field: string): number => {
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${field} exceeds Number.MAX_SAFE_INTEGER`);
  }
  if (value < BigInt(0)) {
    throw new RangeError(`${field} must be non-negative`);
  }
  return Number(value);
};

export const mergeIbcCoverageRows = (rows: readonly IbcCoverageCountRow[]): IbcCoverageCounts => {
  let eligiblePackets = BigInt(0);
  let pricedPackets = BigInt(0);
  let unpricedPackets = BigInt(0);
  const unpricedDenoms = new Set<string>();

  for (const row of rows) {
    eligiblePackets += row.eligible_packets ?? BigInt(0);
    pricedPackets += row.priced_packets ?? BigInt(0);
    unpricedPackets += row.unpriced_packets ?? BigInt(0);
    for (const denom of row.unpriced_denoms ?? []) {
      unpricedDenoms.add(normalizeUnpricedDenom(denom));
    }
  }

  return {
    eligiblePackets,
    pricedPackets,
    unpricedPackets,
    unpricedDenoms: [...unpricedDenoms].sort(),
  };
};

export const assertIbcCoverageIdentity = (counts: IbcCoverageCounts): void => {
  if (counts.eligiblePackets !== counts.pricedPackets + counts.unpricedPackets) {
    throw new Error(
      `IBC coverage invariant failed: eligible=${counts.eligiblePackets} priced=${counts.pricedPackets} unpriced=${counts.unpricedPackets}`,
    );
  }
};

const toPacketCoverage = (counts: IbcCoverageCounts): IbcPacketCoverage => {
  assertIbcCoverageIdentity(counts);
  return {
    eligible_packets: toSafeCount(counts.eligiblePackets, 'eligible_packets'),
    priced_packets: toSafeCount(counts.pricedPackets, 'priced_packets'),
    unpriced_packets: toSafeCount(counts.unpricedPackets, 'unpriced_packets'),
    unpriced_denoms: [...counts.unpricedDenoms],
  };
};

export const toIbcCoverageStatus = (
  quality: IbcCoverageQuality,
  counts?: IbcCoverageCounts,
): IbcCoverageStatus => {
  if (quality === 'mixed') return { quality, coverage: null };
  if (quality === 'legacy_unverified') return { quality, coverage: null };
  if (!counts) throw new Error('corrected IBC coverage requires counts');
  return { quality, coverage: toPacketCoverage(counts) };
};
