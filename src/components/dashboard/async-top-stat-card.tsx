import { getStats } from "@/services/stats-service";
import Card, { CardSubtext, CardValue } from "@/components/ui/card";
import type { Direction } from "@/components/dashboard/direction-toggle";
import type { Period } from "@/components/dashboard/period-tabs";

const formatUsd = (s: string) => {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

interface Props {
  direction: Direction;
  period: Period;
}

export default async function AsyncTopStatCard({ direction, period }: Props) {
  const stats = await getStats({ direction });
  return (
    <Card>
      <CardValue>${formatUsd(stats.volume_usd[period])}</CardValue>
      <CardSubtext>USD</CardSubtext>
    </Card>
  );
}
