import { getAssetsBreakdown } from "@/services/assets-service";
import TopAssetsCard from "@/components/dashboard/top-assets-card";
import type { Direction } from "@/components/dashboard/direction-toggle";
import type { Period } from "@/components/dashboard/period-tabs";

interface Props {
  direction: Direction;
  period: Period;
  limit?: number;
}

export default async function AsyncTopAssets({
  direction,
  period,
  limit = 5,
}: Props) {
  const breakdown = await getAssetsBreakdown({ direction, period, limit, chain: null });
  return (
    <TopAssetsCard
      data={breakdown.data}
      period={period}
      direction={direction}
    />
  );
}
