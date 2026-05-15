import type { FC, ReactNode } from "react";
import Card, { CardHeader, CardSubtext, CardValue } from "@/components/ui/card";
import type { Period } from "@/components/dashboard/period-tabs";

export interface StatsDto {
  transfers_count: Record<Period, number>;
  volume_atom: Record<Period, string>;
  volume_usd: Record<Period, string>;
  as_of: string;
}

interface StatsCardsProps {
  stats: StatsDto;
  period: Period;
  sparklines?: {
    transfers?: ReactNode;
    volumeAtom?: ReactNode;
    volumeUsd?: ReactNode;
  };
}

const formatCount = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const formatNumberString = (s: string, maxFrac = 2) => {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-US", { maximumFractionDigits: maxFrac });
};

const StatsCards: FC<StatsCardsProps> = ({ stats, period, sparklines }) => {
  const transfers = stats.transfers_count[period];
  const atom = stats.volume_atom[period];
  const usd = stats.volume_usd[period];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
      <Card>
        <CardHeader>Transfers · {period}</CardHeader>
        <CardValue>{formatCount(transfers)}</CardValue>
        <CardSubtext>packets</CardSubtext>
        {sparklines?.transfers && (
          <div className="mt-3 h-12">{sparklines.transfers}</div>
        )}
      </Card>

      <Card>
        <CardHeader>Volume · {period}</CardHeader>
        <CardValue>{formatNumberString(atom, 2)}</CardValue>
        <CardSubtext>ATOM</CardSubtext>
        {sparklines?.volumeAtom && (
          <div className="mt-3 h-12">{sparklines.volumeAtom}</div>
        )}
      </Card>

      <Card>
        <CardHeader>Volume · {period}</CardHeader>
        <CardValue>${formatNumberString(usd, 0)}</CardValue>
        <CardSubtext>USD</CardSubtext>
        {sparklines?.volumeUsd && (
          <div className="mt-3 h-12">{sparklines.volumeUsd}</div>
        )}
      </Card>
    </div>
  );
};

export default StatsCards;
