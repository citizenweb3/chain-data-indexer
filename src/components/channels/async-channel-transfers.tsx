import {
  listTransfers,
  type TransferFilterDirection,
} from "@/services/transfers-service";
import TransfersTable from "@/components/transfers/transfers-table";
import type { Period } from "@/components/dashboard/period-tabs";
import type { ChainName } from "@/lib/chains";

const MS_PER_DAY = 86_400_000;

const periodToSince = (period: Period): Date => {
  const days = period === "24h" ? 1 : period === "7d" ? 7 : 30;
  return new Date(Date.now() - days * MS_PER_DAY);
};

interface AsyncChannelTransfersProps {
  channelIdSrc: string;
  direction: TransferFilterDirection;
  period: Period;
  limit: number;
  offset: number;
  currentSearch: URLSearchParams;
  chain: ChainName;
}

export default async function AsyncChannelTransfers({
  channelIdSrc,
  direction,
  period,
  limit,
  offset,
  currentSearch,
  chain,
}: AsyncChannelTransfersProps) {
  const result = await listTransfers({
    limit,
    offset,
    channelOnHub: channelIdSrc,
    direction,
    since: periodToSince(period),
    chain,
  });

  const totalRows = Number(result.total);
  const pageLength = Math.max(
    1,
    Math.ceil((Number.isFinite(totalRows) ? totalRows : 0) / limit),
  );

  return (
    <TransfersTable
      transfers={result.data}
      pageLength={pageLength}
      currentSearch={currentSearch}
      chain={chain}
    />
  );
}
