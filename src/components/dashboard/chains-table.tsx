import Link from "next/link";
import { formatDistanceToNow } from "date-fns";
import BaseTable from "@/components/common/table/base-table";
import BaseTableRow from "@/components/common/table/base-table-row";
import BaseTableCell from "@/components/common/table/base-table-cell";
import TableHeaderItem from "@/components/common/table/table-header-item";
import { getStats } from "@/services/stats-service";
import { getSyncWatermarks } from "@/services/health-service";
import type { Direction } from "@/components/dashboard/direction-toggle";
import type { Period } from "@/components/dashboard/period-tabs";
import { CHAIN_DISPLAY_NAMES, type ChainName } from "@/lib/chains";

interface Props {
  direction: Direction;
  period: Period;
}

const formatCount = (n: number): string =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const formatUsd = (s: string): string => {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

const formatRelative = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return formatDistanceToNow(d, { addSuffix: true });
};

const HEARTBEAT_STALE_MINUTES = 2;
const isHeartbeatStale = (iso: string | null): boolean => {
  if (!iso) return true;
  return (Date.now() - new Date(iso).getTime()) / 60000 > HEARTBEAT_STALE_MINUTES;
};

export default async function ChainsTable({ direction, period }: Props) {
  const [stats, watermarks] = await Promise.all([
    getStats({ direction, chain: null, breakdown: "chain" }),
    getSyncWatermarks(),
  ]);
  const wmByChain = new Map(watermarks.map((w) => [w.chain, w]));

  const rows = (stats.per_chain ?? [])
    .map((r) => {
      const w = wmByChain.get(r.chain as ChainName) ?? null;
      return {
        chain: r.chain,
        displayName: CHAIN_DISPLAY_NAMES[r.chain] ?? r.chain,
        transfers: r.transfers_count[period],
        volume: r.volume_usd[period],
        lastActivity: w?.last_synced_at ?? null,
        lastSyncAttempt: w?.last_sync_attempt_at ?? null,
      };
    })
    .sort((a, b) => {
      const cmp = Number(b.volume) - Number(a.volume);
      if (cmp !== 0) return cmp;
      return b.transfers - a.transfers;
    });

  return (
    <BaseTable>
      <thead>
        <tr className="bg-table_header">
          <TableHeaderItem label="#" />
          <TableHeaderItem label="Chain" />
          <TableHeaderItem label="Transfers" />
          <TableHeaderItem label="Volume (USD)" />
          <TableHeaderItem label="Last activity" />
          <TableHeaderItem label="Sync" />
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr>
            <td
              colSpan={6}
              className="bg-table_row py-8 text-center font-sfpro text-sm text-white/50"
            >
              No data.
            </td>
          </tr>
        ) : (
          rows.map((r, i) => {
            const link = `/${r.chain}/dashboard`;
            const heartbeatStale = isHeartbeatStale(r.lastSyncAttempt);
            return (
              <BaseTableRow key={r.chain}>
                <BaseTableCell className="py-3">
                  <Link href={link} className="block text-center">
                    <span className="font-handjet text-lg text-white/40">
                      {i + 1}
                    </span>
                  </Link>
                </BaseTableCell>
                <BaseTableCell className="py-3 hover:text-highlight">
                  <Link
                    href={link}
                    className="block text-center underline-offset-4 hover:underline"
                  >
                    <div className="font-handjet text-lg">{r.displayName}</div>
                  </Link>
                </BaseTableCell>
                <BaseTableCell className="py-3">
                  <Link href={link} className="block">
                    <div className="text-center font-handjet text-lg">
                      {formatCount(r.transfers)}
                    </div>
                  </Link>
                </BaseTableCell>
                <BaseTableCell className="py-3">
                  <Link href={link} className="block">
                    <div className="text-center font-handjet text-lg">
                      ${formatUsd(r.volume)}
                    </div>
                  </Link>
                </BaseTableCell>
                <BaseTableCell className="py-3">
                  <Link href={link} className="block">
                    <div className="text-center font-sfpro text-sm text-white/70">
                      {formatRelative(r.lastActivity)}
                    </div>
                  </Link>
                </BaseTableCell>
                <BaseTableCell className="py-3">
                  <Link href={link} className="block">
                    <div className="flex items-center justify-center gap-2 font-sfpro text-sm text-white/70">
                      <span
                        aria-hidden
                        title={
                          heartbeatStale
                            ? "Worker heartbeat is stale (>2 min)"
                            : "Worker is healthy"
                        }
                        className={
                          heartbeatStale
                            ? "bg-highlight inline-block h-1.5 w-1.5 rounded-full"
                            : "bg-secondary inline-block h-1.5 w-1.5 rounded-full"
                        }
                      />
                      {formatRelative(r.lastSyncAttempt)}
                    </div>
                  </Link>
                </BaseTableCell>
              </BaseTableRow>
            );
          })
        )}
      </tbody>
    </BaseTable>
  );
}
