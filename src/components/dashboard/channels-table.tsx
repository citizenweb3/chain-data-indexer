import type { FC } from "react";
import BaseTable from "@/components/common/table/base-table";
import TableHeaderItem from "@/components/common/table/table-header-item";
import TablePagination from "@/components/common/table/table-pagination";
import ChannelsTableRow, {
  type ChannelDto,
} from "@/components/dashboard/channels-table-row";
import type { Period } from "@/components/dashboard/period-tabs";

interface ChannelsTableProps {
  channels: ChannelDto[];
  period: Period;
  pageLength?: number;
  currentSearch?: string | URLSearchParams;
  pageParam?: string;
}

const ChannelsTable: FC<ChannelsTableProps> = ({
  channels,
  period,
  pageLength,
  currentSearch,
  pageParam = "p",
}) => {
  return (
    <div className="flex flex-col gap-4">
      <BaseTable>
        <thead>
          <tr className="bg-table_header">
            <TableHeaderItem label="Channel" />
            <TableHeaderItem label="Counterparty" />
            <TableHeaderItem
              label="Transfers"
              field="transfers"
              defaultSelected
            />
            <TableHeaderItem label="Volume (ATOM)" field="volume_atom" />
            <TableHeaderItem label="Volume (USD)" />
            <TableHeaderItem label="Success (30d)" />
            <TableHeaderItem label="Last activity" field="last_activity" />
          </tr>
        </thead>
        <tbody>
          {channels.length === 0 ? (
            <tr>
              <td
                colSpan={7}
                className="bg-table_row py-8 text-center font-sfpro text-sm text-white/50"
              >
                No channels for this period and direction.
              </td>
            </tr>
          ) : (
            channels.map((c) => (
              <ChannelsTableRow
                key={`${c.port_id_src}/${c.channel_id_src}`}
                channel={c}
                period={period}
              />
            ))
          )}
        </tbody>
      </BaseTable>

      {pageLength && pageLength > 1 && (
        <TablePagination
          pageLength={pageLength}
          currentSearch={currentSearch}
          pageParam={pageParam}
        />
      )}
    </div>
  );
};

export default ChannelsTable;
