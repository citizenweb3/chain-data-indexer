import Link from "next/link";
import type { FC } from "react";
import { formatDistanceToNow } from "date-fns";
import BaseTableCell from "@/components/common/table/base-table-cell";
import BaseTableRow from "@/components/common/table/base-table-row";
import { cn } from "@/utils/cn";
import { formatDenomDisplay } from "@/utils/format-denom";
import TxHashCell from "@/components/transfers/tx-hash-cell";

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
  tx_hash_recv: string | null;
  tx_hash_ack: string | null;
  asset_symbol: string | null;
  asset_decimals: number | null;
}

interface TransfersTableRowProps {
  transfer: TransferRowDto;
}

const statusColor = (status: TransferRowDto["status"]) => {
  if (status === "acknowledged") return "text-secondary";
  if (status === "timeout" || status === "failed") return "text-red";
  return "text-highlight";
};

const pickHash = (transfer: TransferRowDto): string | null =>
  transfer.tx_hash_send ?? transfer.tx_hash_recv ?? transfer.tx_hash_ack;

const formatAmount = (
  amount: string | null,
  denom: string | null,
  symbol: string | null,
  decimals: number | null,
) => {
  if (!amount || !denom) return "—";
  const display = formatDenomDisplay(denom, symbol);
  const n = Number(amount);
  if (!Number.isFinite(n)) return `${amount} ${display}`;
  const scaled = decimals !== null ? n / Math.pow(10, decimals) : n;
  return `${scaled.toLocaleString("en-US", {
    maximumFractionDigits: decimals ? 6 : 0,
  })} ${display}`;
};

const buildAmountTooltip = (
  amount: string | null,
  denom: string | null,
  symbol: string | null,
  decimals: number | null,
): string => {
  if (!amount || !denom) return "no amount";
  const lines: string[] = [];
  const rawN = Number(amount);
  const rawLabel = Number.isFinite(rawN)
    ? rawN.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : amount;
  lines.push(`Raw amount: ${rawLabel}`);
  if (decimals !== null && Number.isFinite(rawN)) {
    const scaled = rawN / Math.pow(10, decimals);
    lines.push(
      `Scaled (10^${decimals}): ${scaled.toLocaleString("en-US", {
        maximumFractionDigits: 6,
      })}${symbol ? ` ${symbol}` : ""}`,
    );
  } else {
    lines.push("Decimals: unknown — value shown is raw base units");
  }
  lines.push("");
  lines.push(`Denom: ${denom}`);
  if (symbol) lines.push(`Symbol: ${symbol}`);
  if (!symbol && denom.startsWith("factory/")) {
    lines.push(
      "Note: token-factory subdenom — name is set by creator, not a canonical symbol",
    );
  }
  return lines.join("\n");
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
        <div
          className={cn(
            "cursor-help text-center font-handjet text-lg",
            transfer.asset_decimals === null && transfer.amount
              ? "text-white/60"
              : undefined,
          )}
          title={buildAmountTooltip(
            transfer.amount,
            transfer.denom,
            transfer.asset_symbol,
            transfer.asset_decimals,
          )}
        >
          {formatAmount(
            transfer.amount,
            transfer.denom,
            transfer.asset_symbol,
            transfer.asset_decimals,
          )}
          {transfer.amount && transfer.asset_decimals === null ? (
            <span className="ml-1 font-sfpro text-xs text-white/40">(?)</span>
          ) : null}
        </div>
      </BaseTableCell>
      <BaseTableCell className="py-3">
        <TxHashCell hash={pickHash(transfer)} />
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
