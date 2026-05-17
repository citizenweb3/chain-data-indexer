import type { FC } from "react";
import Link from "next/link";
import Card from "@/components/ui/card";
import type { Period } from "@/components/dashboard/period-tabs";
import type { Direction } from "@/components/dashboard/direction-toggle";
import { formatNative } from "@/utils/format-amount";

export interface AssetBreakdownDto {
  native_denom: string;
  symbol: string | null;
  decimals: number | null;
  display: string;
  transfers_count: number;
  amount_native: string;
  amount_usd: string;
}

interface TopAssetsCardProps {
  data: AssetBreakdownDto[];
  period: Period;
  direction: Direction;
  limit?: number;
}

const formatCount = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const formatUsdNumber = (s: string) => {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

const formatNativeAmount = (raw: string, decimals: number | null) => {
  if (decimals === null) return raw;
  const formatted = formatNative(raw, decimals);
  if (formatted === null) return raw;
  const n = Number(formatted);
  if (!Number.isFinite(n)) return formatted;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const TopAssetsCard: FC<TopAssetsCardProps> = ({
  data,
  period,
  direction,
  limit = 5,
}) => {
  const rows = data.slice(0, limit);
  const seeAllSearch = new URLSearchParams({ period, direction });
  return (
    <Card>
      <div className="mb-3 flex items-center justify-end">
        <Link
          href={`/assets?${seeAllSearch.toString()}`}
          className="font-sfpro text-xs text-white/70 underline underline-offset-4 hover:text-highlight"
        >
          See all →
        </Link>
      </div>
      {rows.length === 0 ? (
        <div className="font-handjet text-lg text-white/40">No data</div>
      ) : (
        <ul className="flex flex-col divide-y divide-bgSt">
          {rows.map((r, i) => (
            <li
              key={r.native_denom}
              className="flex items-center gap-3 py-2"
            >
              <span className="w-6 font-handjet text-base text-white/40">
                {i + 1}.
              </span>
              <span
                className="w-28 truncate font-handjet text-lg text-white"
                title={r.native_denom}
              >
                {r.display}
              </span>
              <span className="flex-1 text-right font-handjet text-lg text-white">
                {formatCount(r.transfers_count)} pkts
              </span>
              <span className="w-44 text-right font-handjet text-lg text-white">
                {formatNativeAmount(r.amount_native, r.decimals)}
                {r.symbol ? ` ${r.symbol}` : ""}
              </span>
              <span className="w-28 text-right font-handjet text-lg text-secondary">
                ${formatUsdNumber(r.amount_usd)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
};

export default TopAssetsCard;
