import Link from "next/link";
import type { FC } from "react";
import { formatDistanceToNow } from "date-fns";
import BaseTableCell from "@/components/common/table/base-table-cell";
import BaseTableRow from "@/components/common/table/base-table-row";
import { cn } from "@/utils/cn";

export interface TransferRowDto {
  port_id_src: string;
  channel_id_src: string;
  sequence: string;
  channel_id_dst: string | null;
  status: "sent" | "received" | "acknowledged" | "timeout" | "failed";
  direction: "outgoing" | "incoming";
  event_time: string | null;
  denom: string | null;
  amount: string | null;
  tx_hash_send: string | null;
}

interface TransfersTableRowProps {
  transfer: TransferRowDto;
}

const statusColor = (status: TransferRowDto["status"]) => {
  if (status === "acknowledged") return "text-secondary";
  if (status === "timeout" || status === "failed") return "text-red";
  return "text-highlight";
};

const shortHash = (hash: string | null) => {
  if (!hash) return "—";
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 6)}…${hash.slice(-6)}`;
};

const formatAmount = (amount: string | null, denom: string | null) => {
  if (!amount || !denom) return "—";
  const n = Number(amount);
  if (!Number.isFinite(n)) return amount;
  return `${n.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${denom}`;
};

const formatRelative = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDistanceToNow(d, { addSuffix: true });
};

const TransfersTableRow: FC<TransfersTableRowProps> = ({ transfer }) => {
  const href = `/transfers/${encodeURIComponent(
    transfer.port_id_src,
  )}/${encodeURIComponent(transfer.channel_id_src)}/${encodeURIComponent(transfer.sequence)}`;

  return (
    <BaseTableRow>
      <BaseTableCell className="py-3 hover:text-highlight">
        <Link
          href={href}
          className="flex justify-center font-handjet text-lg underline underline-offset-4"
        >
          {transfer.sequence}
        </Link>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div className="text-center font-handjet text-lg">
          {transfer.channel_id_src}
          {transfer.channel_id_dst ? ` → ${transfer.channel_id_dst}` : ""}
        </div>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div className="text-center font-sfpro text-sm uppercase tracking-wide text-white/70">
          {transfer.direction}
        </div>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div
          className={cn(
            "text-center font-handjet text-lg",
            statusColor(transfer.status),
          )}
        >
          {transfer.status}
        </div>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div className="text-center font-handjet text-lg">
          {formatAmount(transfer.amount, transfer.denom)}
        </div>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div className="text-center font-handjet text-sm text-white/70">
          {shortHash(transfer.tx_hash_send)}
        </div>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <div className="text-center font-sfpro text-sm text-white/70">
          {formatRelative(transfer.event_time)}
        </div>
      </BaseTableCell>
    </BaseTableRow>
  );
};

export default TransfersTableRow;
