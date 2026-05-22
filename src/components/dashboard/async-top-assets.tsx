import { getAssetsBreakdown } from "@/services/assets-service";
import TopAssetsCard from "@/components/dashboard/top-assets-card";
import type { Direction } from "@/components/dashboard/direction-toggle";
import type { Period } from "@/components/dashboard/period-tabs";
import type { ChainName } from "@/lib/chains";

interface Props {
  direction: Direction;
  period: Period;
  limit?: number;
  chain: ChainName;
}

export default async function AsyncTopAssets({
  direction,
  period,
  limit = 5,
  chain,
}: Props) {
  const breakdown = await getAssetsBreakdown({ direction, period, limit, chain });
  return (
    <TopAssetsCard
      data={breakdown.data}
      period={period}
      direction={direction}
      chain={chain}
    />
  );
}
