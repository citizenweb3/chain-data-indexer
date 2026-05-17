import type { FC } from "react";
import BaseTableCell from "@/components/common/table/base-table-cell";
import BaseTableRow from "@/components/common/table/base-table-row";
import { formatNative } from "@/utils/format-amount";

export interface AssetRowDto {
  native_denom: string;
  symbol: string | null;
  decimals: number | null;
  display: string;
  transfers_count: number;
  amount_native: string;
  amount_usd: string;
}

interface AssetsTableRowProps {
  rank: number;
  asset: AssetRowDto;
  totalUsd: number;
}

const formatCount = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const formatNativeAmount = (raw: string, decimals: number | null) => {
  if (decimals === null) return raw;
  const formatted = formatNative(raw, decimals);
  if (formatted === null) return raw;
  const n = Number(formatted);
  if (!Number.isFinite(n)) return formatted;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const formatUsd = (s: string) => {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (n === 0) return "0";
  if (n < 0.01) return n.toPrecision(2);
  if (n < 1) return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

const AssetsTableRow: FC<AssetsTableRowProps> = ({ rank, asset, totalUsd }) => {
  const usd = Number(asset.amount_usd);
  const share =
    totalUsd > 0 && Number.isFinite(usd) ? (usd / totalUsd) * 100 : null;
  return (
    <BaseTableRow>
      <BaseTableCell className="py-3">
        <div className="text-center font-handjet text-lg text-white/50">
          {rank}
        </div>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div
          style={{ width: "10rem", maxWidth: "10rem" }}
          className="mx-auto overflow-hidden text-ellipsis whitespace-nowrap text-center font-handjet text-xl text-white"
          title={asset.native_denom}
        >
          {asset.display}
        </div>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div
          style={{ width: "18rem", maxWidth: "18rem" }}
          className="mx-auto overflow-hidden text-ellipsis whitespace-nowrap text-center font-sfpro text-sm text-white"
          title={asset.native_denom}
        >
          {asset.native_denom}
        </div>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div className="text-center font-handjet text-lg">
          {formatCount(asset.transfers_count)}
        </div>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div className="text-center font-handjet text-lg">
          {formatNativeAmount(asset.amount_native, asset.decimals)}
          {asset.symbol ? (
            <span className="ml-1 text-white/50">{asset.symbol}</span>
          ) : null}
        </div>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div className="text-center font-handjet text-lg text-secondary">
          ${formatUsd(asset.amount_usd)}
        </div>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div className="text-center font-handjet text-lg text-white/70">
          {share === null ? "—" : `${share.toFixed(1)}%`}
        </div>
      </BaseTableCell>
    </BaseTableRow>
  );
};

export default AssetsTableRow;
