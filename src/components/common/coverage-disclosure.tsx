import type { FC } from 'react';

import { CHAIN_DISPLAY_NAMES } from '@/lib/chains';
import type { IbcCoverageStatus, IbcSourceFreshness } from '@/schemas/ibc-aggregation';
import { cn } from '@/utils/cn';

export const summarizeCoverageStatuses = (
  statuses: readonly IbcCoverageStatus[],
): IbcCoverageStatus => {
  if (statuses.length === 0) {
    return {
      quality: 'corrected',
      coverage: {
        eligible_packets: 0,
        priced_packets: 0,
        unpriced_packets: 0,
        unpriced_denoms: [],
      },
    };
  }
  if (statuses.every((status) => status.quality === 'legacy_unverified')) {
    return { quality: 'legacy_unverified', coverage: null };
  }
  if (!statuses.every((status) => status.quality === 'corrected')) {
    return { quality: 'mixed', coverage: null };
  }

  const unpricedDenoms = new Set<string>();
  let eligiblePackets = 0;
  let pricedPackets = 0;
  let unpricedPackets = 0;
  for (const status of statuses) {
    if (status.quality !== 'corrected') continue;
    eligiblePackets += status.coverage.eligible_packets;
    pricedPackets += status.coverage.priced_packets;
    unpricedPackets += status.coverage.unpriced_packets;
    for (const denom of status.coverage.unpriced_denoms) {
      unpricedDenoms.add(denom);
    }
  }

  return {
    quality: 'corrected',
    coverage: {
      eligible_packets: eligiblePackets,
      priced_packets: pricedPackets,
      unpriced_packets: unpricedPackets,
      unpriced_denoms: [...unpricedDenoms].sort(),
    },
  };
};

interface CoverageDisclosureProps {
  status: IbcCoverageStatus;
  sources?: readonly IbcSourceFreshness[];
  compact?: boolean;
  className?: string;
}

const formatCorrectionBoundaries = (sources: readonly IbcSourceFreshness[]): string =>
  sources
    .map((source) => {
      const name = CHAIN_DISPLAY_NAMES[source.chain];
      return `${name}: ${source.corrected_from ?? 'not yet corrected'}`;
    })
    .join(' · ');

const CoverageDisclosure: FC<CoverageDisclosureProps> = ({
  status,
  sources = [],
  compact = false,
  className,
}) => {
  if (status.quality === 'corrected') {
    const coverage = status.coverage;
    const pricedPercent =
      coverage.eligible_packets === 0
        ? null
        : (coverage.priced_packets / coverage.eligible_packets) * 100;
    const unpricedDenoms = coverage.unpriced_denoms.join(', ');
    return (
      <p
        role="status"
        aria-label="IBC aggregate pricing coverage"
        className={cn(
          'font-sfpro text-xs text-white/50',
          !compact && 'border-bgSt border-l-2 pl-3',
          className,
        )}
      >
        {pricedPercent === null
          ? 'Pricing coverage: no delivered packets in this scope.'
          : `Pricing coverage: ${coverage.priced_packets.toLocaleString('en-US')} of ${coverage.eligible_packets.toLocaleString('en-US')} delivered packets priced (${pricedPercent.toFixed(1)}%).`}
        {coverage.unpriced_packets > 0
          ? ` ${coverage.unpriced_packets.toLocaleString('en-US')} unpriced${unpricedDenoms ? `: ${unpricedDenoms}.` : '.'}`
          : null}
      </p>
    );
  }

  const boundaries = sources.length > 0 ? formatCorrectionBoundaries(sources) : null;
  const message =
    status.quality === 'mixed'
      ? 'Mixed aggregate: this scope spans corrected and legacy-unverified buckets; pricing coverage is unavailable.'
      : 'Legacy aggregate: this scope predates the delivered-only correction; pricing coverage is unavailable.';
  return (
    <p
      role="status"
      aria-label="IBC aggregate quality warning"
      className={cn(
        'font-sfpro text-highlight text-xs',
        !compact && 'border-highlight border-l-2 pl-3',
        className,
      )}
    >
      {message}
      {boundaries ? ` Corrected from ${boundaries}.` : null}
    </p>
  );
};

export default CoverageDisclosure;
