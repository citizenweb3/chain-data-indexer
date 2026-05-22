import { getStats } from "@/services/stats-service";
import { getSyncWatermarks } from "@/services/health-service";
import type { Direction } from "@/components/dashboard/direction-toggle";
import type { Period } from "@/components/dashboard/period-tabs";
import { CHAIN_NAMES } from "@/lib/chains";

interface Props {
  direction: Direction;
  period: Period;
}

const formatUsd = (s: string): string => {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}k`;
  return `$${n.toFixed(0)}`;
};

const formatCount = (n: number): string => {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

const formatRelative = (iso: string | null): string => {
  if (!iso) return "no data";
  const diffSec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `${Math.round(diffSec)}s ago`;
  const m = Math.round(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

type TileProps = {
  label: string;
  value: string;
  sub: string;
};

const Tile = ({ label, value, sub }: TileProps) => (
  <div className="border-bgSt bg-table_row flex flex-col gap-2 border p-5">
    <div className="font-sfpro text-[11px] uppercase tracking-[0.18em] text-white/45">
      {label}
    </div>
    <div className="font-handjet text-3xl leading-none tracking-wide text-white">
      {value}
    </div>
    <div className="font-sfpro text-xs text-white/50">{sub}</div>
  </div>
);

export default async function AsyncStatTiles({ direction, period }: Props) {
  const [stats, watermarks] = await Promise.all([
    getStats({ direction, chain: null }),
    getSyncWatermarks(),
  ]);

  const transfers = stats.transfers_count[period];
  const volume = stats.volume_usd[period];

  const totalChains = CHAIN_NAMES.length;
  const liveChains = watermarks.filter((w) => w.last_synced_at !== null).length;

  const latestSyncTimestamp = watermarks
    .map((w) => (w.last_synced_at ? new Date(w.last_synced_at).getTime() : 0))
    .reduce((a, b) => Math.max(a, b), 0);
  const latestSyncIso =
    latestSyncTimestamp > 0 ? new Date(latestSyncTimestamp).toISOString() : null;

  const periodLabel: Record<Period, string> = {
    "24h": "last 24h",
    "7d": "last 7 days",
    "30d": "last 30 days",
  };

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Tile
        label="Volume"
        value={formatUsd(volume)}
        sub={`USD · ${periodLabel[period]}`}
      />
      <Tile
        label="Transfers"
        value={formatCount(transfers)}
        sub={`packets · ${periodLabel[period]}`}
      />
      <Tile
        label="Chains"
        value={`${liveChains} / ${totalChains}`}
        sub={liveChains === totalChains ? "all live" : "indexed"}
      />
      <Tile
        label="Last sync"
        value={formatRelative(latestSyncIso)}
        sub={
          latestSyncIso
            ? new Date(latestSyncIso).toLocaleString("en-GB", { timeZone: "UTC" }) +
              " UTC"
            : "—"
        }
      />
    </div>
  );
}
