import Link from "next/link";
import type { FC } from "react";
import { formatDistanceToNow } from "date-fns";
import BaseTableCell from "@/components/common/table/base-table-cell";
import BaseTableRow from "@/components/common/table/base-table-row";
import type { Period } from "@/components/dashboard/period-tabs";
import { cn } from "@/utils/cn";
import { formatNative } from "@/utils/format-amount";

export interface ChannelDenom {
  display: string;
  native_denom: string;
  symbol: string | null;
  decimals: number | null;
  count: number;
  amount_native: string;
  amount_usd: string;
  raws: string[];
}

export interface ChannelDto {
  channel_id_src: string;
  port_id_src: string;
  channel_id_dst: string | null;
  counterparty_chain_id: string | null;
  counterparty_chain_name: string | null;
  transfers: Record<Period, number>;
  volume_atom: Record<Period, string>;
  volume_usd: Record<Period, string>;
  success_rate_30d: number | null;
  last_activity: string | null;
  denoms: ChannelDenom[];
}

const formatChainName = (slug: string): string =>
  slug.charAt(0).toUpperCase() + slug.slice(1);

interface ChannelsTableRowProps {
  channel: ChannelDto;
  period: Period;
}

const formatCount = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const formatNumberString = (s: string, maxFrac = 2) => {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-US", { maximumFractionDigits: maxFrac });
};

const successColor = (rate: number) => {
  if (rate >= 0.95) return "text-secondary";
  if (rate >= 0.8) return "text-highlight";
  return "text-red";
};

const formatRelative = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDistanceToNow(d, { addSuffix: true });
};

const formatNativeShort = (raw: string, decimals: number | null) => {
  if (decimals === null) return raw;
  const formatted = formatNative(raw, decimals);
  if (formatted === null) return raw;
  const n = Number(formatted);
  if (!Number.isFinite(n)) return formatted;
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
};

const formatUsdShort = (s: string) => {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

const buildDenomTooltip = (denoms: ChannelDenom[]): string =>
  denoms
    .map((d) => {
      const native = formatNativeShort(d.amount_native, d.decimals);
      const tail = d.symbol ? ` ${d.symbol}` : "";
      const usd = Number(d.amount_usd) > 0
        ? ` · $${formatUsdShort(d.amount_usd)}`
        : "";
      const head = `${d.display} (${d.count.toLocaleString("en-US")} pkts · ${native}${tail}${usd})`;
      if (d.raws.length === 0) return head;
      const indented = d.raws.map((r) => `  • ${r}`).join("\n");
      return `${head}\n${indented}`;
    })
    .join("\n\n");

const ChannelsTableRow: FC<ChannelsTableRowProps> = ({ channel, period }) => {
  const link = `/channels/${encodeURIComponent(channel.channel_id_src)}`;
  return (
    <BaseTableRow>
      <BaseTableCell className="py-3 hover:text-highlight">
        <Link
          href={link}
          className="flex justify-center font-handjet text-lg underline underline-offset-4"
        >
          {channel.channel_id_src}
        </Link>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div className="flex flex-col items-center">
          <div className="font-handjet text-lg">
            {channel.counterparty_chain_name
              ? formatChainName(channel.counterparty_chain_name)
              : "—"}
          </div>
          {channel.channel_id_dst && (
            <div className="font-sfpro text-xs text-white/50">
              {channel.channel_id_dst}
            </div>
          )}
        </div>
      </BaseTableCell>
      <BaseTableCell className="max-w-[14rem] py-3">
        {channel.denoms.length === 0 ? (
          <div className="text-center font-handjet text-lg text-white/40">
            —
          </div>
        ) : (
          <div
            className="truncate text-center font-handjet text-lg"
            title={buildDenomTooltip(channel.denoms)}
          >
            {channel.denoms.map((d) => d.display).join(", ")}
          </div>
        )}
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div className="text-center font-handjet text-lg">
          {formatCount(channel.transfers[period])}
        </div>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div className="text-center font-handjet text-lg">
          ${formatNumberString(channel.volume_usd[period], 0)}
        </div>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        {channel.success_rate_30d === null ? (
          <div className="text-center font-handjet text-lg text-white/40">
            —
          </div>
        ) : (
          <div
            className={cn(
              "text-center font-handjet text-lg",
              successColor(channel.success_rate_30d),
            )}
          >
            {(channel.success_rate_30d * 100).toFixed(1)}%
          </div>
        )}
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div className="text-center font-sfpro text-sm text-white/70">
          {formatRelative(channel.last_activity)}
        </div>
      </BaseTableCell>
    </BaseTableRow>
  );
};

export default ChannelsTableRow;
