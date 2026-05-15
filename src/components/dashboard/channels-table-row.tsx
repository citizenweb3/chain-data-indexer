import Link from "next/link";
import type { FC } from "react";
import { formatDistanceToNow } from "date-fns";
import BaseTableCell from "@/components/common/table/base-table-cell";
import BaseTableRow from "@/components/common/table/base-table-row";
import type { Period } from "@/components/dashboard/period-tabs";
import { cn } from "@/utils/cn";

export interface ChannelDto {
  channel_id_src: string;
  port_id_src: string;
  channel_id_dst: string | null;
  transfers: Record<Period, number>;
  volume_atom: Record<Period, string>;
  volume_usd: Record<Period, string>;
  success_rate_30d: number | null;
  last_activity: string | null;
}

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
        <div className="text-center font-handjet text-lg">
          {channel.channel_id_dst ?? "—"}
        </div>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div className="text-center font-handjet text-lg">
          {formatCount(channel.transfers[period])}
        </div>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div className="text-center font-handjet text-lg">
          {formatNumberString(channel.volume_atom[period], 2)}
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
