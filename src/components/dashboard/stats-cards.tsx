import type { FC, ReactNode } from 'react';
import Card, { CardHeader, CardSubtext, CardValue } from '@/components/ui/card';
import type { Period } from '@/components/dashboard/period-tabs';
import type { IbcCoverageStatus } from '@/schemas/ibc-aggregation';
import CoverageDisclosure from '@/components/common/coverage-disclosure';

export interface StatsDto {
  transfers_count: Record<Period, number>;
  volume_atom: Record<Period, string>;
  volume_native?: Record<Period, string>;
  volume_usd: Record<Period, string>;
  native_symbol?: string;
  coverage?: Record<Period, IbcCoverageStatus>;
  as_of: string;
}

interface StatsCardsProps {
  stats: StatsDto;
  period: Period;
  sparklines?: {
    transfers?: ReactNode;
    volumeAtom?: ReactNode;
    volumeNative?: ReactNode;
    volumeUsd?: ReactNode;
  };
}

const formatCount = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

const formatNumberString = (s: string, maxFrac = 2) => {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString('en-US', { maximumFractionDigits: maxFrac });
};

const StatsCards: FC<StatsCardsProps> = ({ stats, period, sparklines }) => {
  const transfers = stats.transfers_count[period];
  const native = stats.volume_native?.[period] ?? stats.volume_atom[period];
  const nativeSymbol = stats.native_symbol ?? 'ATOM';
  const usd = stats.volume_usd[period];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card>
        <CardHeader>Transfers · {period}</CardHeader>
        <CardValue>{formatCount(transfers)}</CardValue>
        <CardSubtext>packets</CardSubtext>
        {sparklines?.transfers && <div className="mt-3 h-12">{sparklines.transfers}</div>}
      </Card>

      <Card>
        <CardHeader>Volume · {period}</CardHeader>
        <CardValue>{formatNumberString(native, 2)}</CardValue>
        <CardSubtext>{nativeSymbol}</CardSubtext>
        {(sparklines?.volumeNative ?? sparklines?.volumeAtom) && (
          <div className="mt-3 h-12">{sparklines?.volumeNative ?? sparklines?.volumeAtom}</div>
        )}
      </Card>

      <Card>
        <CardHeader>Volume · {period}</CardHeader>
        <CardValue>${formatNumberString(usd, 0)}</CardValue>
        <CardSubtext>USD</CardSubtext>
        {stats.coverage ? (
          <CoverageDisclosure status={stats.coverage[period]} compact className="mt-2" />
        ) : null}
        {sparklines?.volumeUsd && <div className="mt-3 h-12">{sparklines.volumeUsd}</div>}
      </Card>
    </div>
  );
};

export default StatsCards;
