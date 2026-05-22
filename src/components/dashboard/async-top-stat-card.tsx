import { getStats } from "@/services/stats-service";
import Card, { CardSubtext, CardValue } from "@/components/ui/card";
import type { Direction } from "@/components/dashboard/direction-toggle";
import type { Period } from "@/components/dashboard/period-tabs";
import type { ChainName } from "@/lib/chains";

const formatUsd = (s: string) => {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

interface Props {
  direction: Direction;
  period: Period;
  chain: ChainName | null;
}

export default async function AsyncTopStatCard({ direction, period, chain }: Props) {
  const stats = await getStats({ direction, chain });
  return (
    <Card>
      <CardValue>${formatUsd(stats.volume_usd[period])}</CardValue>
      <CardSubtext>USD</CardSubtext>
    </Card>
  );
}
