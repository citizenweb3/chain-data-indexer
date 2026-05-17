import type { FC } from "react";
import BaseTable from "@/components/common/table/base-table";
import TableHeaderItem from "@/components/common/table/table-header-item";
import TablePagination from "@/components/common/table/table-pagination";
import AssetsTableRow, {
  type AssetRowDto,
} from "@/components/assets/assets-table-row";

interface AssetsTableProps {
  assets: AssetRowDto[];
  totalUsd: number;
  startRank?: number;
  pageLength?: number;
  currentSearch?: string | URLSearchParams;
  pageParam?: string;
}

const AssetsTable: FC<AssetsTableProps> = ({
  assets,
  totalUsd,
  startRank = 1,
  pageLength,
  currentSearch,
  pageParam = "p",
}) => {
  return (
    <div className="flex flex-col gap-4">
      <div className="min-w-0 max-w-full overflow-x-auto">
        <BaseTable>
          <thead>
            <tr className="bg-table_header">
              <TableHeaderItem label="#" />
              <TableHeaderItem label="Asset" />
              <TableHeaderItem label="Base denom" />
              <TableHeaderItem label="Transfers" field="transfers" />
              <TableHeaderItem label="Volume (native)" />
              <TableHeaderItem
                label="Volume (USD)"
                field="volume_usd"
                defaultSelected
              />
              <TableHeaderItem label="Share" field="share" />
            </tr>
          </thead>
          <tbody>
            {assets.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="bg-table_row py-8 text-center font-sfpro text-sm text-white/50"
                >
                  No assets for this period and direction.
                </td>
              </tr>
            ) : (
              assets.map((a, i) => (
                <AssetsTableRow
                  key={a.native_denom}
                  rank={startRank + i}
                  asset={a}
                  totalUsd={totalUsd}
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

export default AssetsTable;
