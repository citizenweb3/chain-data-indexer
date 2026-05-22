import {
  listChannels,
  type ChannelsDirection,
  type ChannelsPeriod,
  type ChannelsSort,
  type SortOrder,
} from "@/services/channels-service";
import ChannelsTable from "@/components/dashboard/channels-table";

interface AsyncChannelsTableProps {
  direction: ChannelsDirection;
  period: ChannelsPeriod;
  sort: ChannelsSort;
  order: SortOrder;
  limit: number;
  offset: number;
  currentSearch: URLSearchParams;
}

export default async function AsyncChannelsTable({
  direction,
  period,
  sort,
  order,
  limit,
  offset,
  currentSearch,
}: AsyncChannelsTableProps) {
  const channels = await listChannels({
    direction,
    period,
    sort,
    order,
    limit,
    offset,
    chain: null,
  });
  const pageLength = Math.max(1, Math.ceil(channels.page.total / limit));
  return (
    <ChannelsTable
      channels={channels.data}
      period={period}
      pageLength={pageLength}
      currentSearch={currentSearch}
    />
  );
}
