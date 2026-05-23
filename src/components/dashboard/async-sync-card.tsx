import { getSyncWatermarks } from "@/services/health-service";
import Card, { CardSubtext, CardValue } from "@/components/ui/card";
import { CHAIN_DISPLAY_NAMES, type ChainName } from "@/lib/chains";

interface Props {
  chain: ChainName | null;
}

const formatTime = (iso: string | null): string =>
  iso ? `${new Date(iso).toLocaleString("en-GB", { timeZone: "UTC" })} UTC` : "no data";

const formatHeight = (h: string | null): string => (h ? `#${h}` : "—");

const formatRelative = (iso: string | null): string => {
  if (!iso) return "—";
  const diffSec = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (diffSec < 60) return `${Math.round(diffSec)}s ago`;
  const m = Math.round(diffSec / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
};

const HEARTBEAT_STALE_MINUTES = 2;
const isHeartbeatStale = (iso: string | null): boolean => {
  if (!iso) return true;
  return (Date.now() - new Date(iso).getTime()) / 60000 > HEARTBEAT_STALE_MINUTES;
};

const HeartbeatDot = ({ stale }: { stale: boolean }) => (
  <span
    aria-hidden
    title={
      stale ? "Worker heartbeat is stale (>2 min)" : "Worker is healthy"
    }
    className={
      stale
        ? "bg-highlight inline-block h-1.5 w-1.5 rounded-full"
        : "bg-secondary inline-block h-1.5 w-1.5 rounded-full"
    }
  />
);

export default async function AsyncSyncCard({ chain }: Props) {
  const all = await getSyncWatermarks();

  if (chain !== null) {
    const w = all.find((x) => x.chain === chain) ?? {
      last_synced_height: null,
      last_synced_at: null,
      last_sync_attempt_at: null,
    };
    return (
      <Card>
        <CardValue>{formatHeight(w.last_synced_height)}</CardValue>
        <CardSubtext>last activity: {formatTime(w.last_synced_at)}</CardSubtext>
        <div className="mt-2 flex items-center gap-2 font-sfpro text-xs text-white/60">
          <HeartbeatDot stale={isHeartbeatStale(w.last_sync_attempt_at)} />
          worker synced {formatRelative(w.last_sync_attempt_at)}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <ul className="flex flex-col divide-y divide-bgSt">
        {all.map((w) => (
          <li key={w.chain} className="flex items-center justify-between gap-3 py-2">
            <span className="font-handjet text-lg text-white">
              {CHAIN_DISPLAY_NAMES[w.chain as ChainName] ?? w.chain}
            </span>
            <span className="font-handjet text-lg text-white">
              {formatHeight(w.last_synced_height)}
            </span>
            <span className="font-sfpro text-xs text-white/60">
              last pkt {formatRelative(w.last_synced_at)}
            </span>
            <span className="flex items-center gap-1.5 font-sfpro text-xs text-white/60">
              <HeartbeatDot stale={isHeartbeatStale(w.last_sync_attempt_at)} />
              {formatRelative(w.last_sync_attempt_at)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
