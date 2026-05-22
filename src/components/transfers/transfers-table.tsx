import type { FC } from "react";
import BaseTable from "@/components/common/table/base-table";
import TableHeaderItem from "@/components/common/table/table-header-item";
import TablePagination from "@/components/common/table/table-pagination";
import TransfersTableRow, {
  type TransferRowDto,
} from "@/components/transfers/transfers-table-row";
import type { ChainName } from "@/lib/chains";

interface TransfersTableProps {
  transfers: TransferRowDto[];
  pageLength?: number;
  currentSearch?: string | URLSearchParams;
  pageParam?: string;
  chain: ChainName;
}

const TransfersTable: FC<TransfersTableProps> = ({
  transfers,
  pageLength,
  currentSearch,
  pageParam = "p",
  chain,
}) => {
  return (
    <div className="flex flex-col gap-4">
      <div className="min-w-0 max-w-full overflow-x-auto">
        <BaseTable>
          <thead>
            <tr className="bg-table_header">
              <TableHeaderItem label="Sequence" />
              <TableHeaderItem label="Channel" />
              <TableHeaderItem label="Direction" />
              <TableHeaderItem label="Status" />
              <TableHeaderItem label="Amount" />
              <TableHeaderItem label="Tx hash" />
              <TableHeaderItem label="When" />
            </tr>
          </thead>
          <tbody>
            {transfers.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="bg-table_row py-8 text-center font-sfpro text-sm text-white/50"
                >
                  No transfers matching these filters.
                </td>
              </tr>
            ) : (
              transfers.map((t) => (
                <TransfersTableRow
                  key={`${t.port_id_src}/${t.channel_id_src}/${t.sequence}`}
                  transfer={t}
                  chain={chain}
                />
              ))
            )}
          </tbody>
        </BaseTable>
      </div>

      {pageLength && pageLength > 1 && (
        <TablePagination
          pageLength={pageLength}
          currentSearch={currentSearch}
          pageParam={pageParam}
          isScroll={false}
        />
      )}
    </div>
  );
};

export default TransfersTable;
