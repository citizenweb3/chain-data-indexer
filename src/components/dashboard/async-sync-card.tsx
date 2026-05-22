import { getSyncWatermarks } from "@/services/health-service";
import Card, { CardSubtext, CardValue } from "@/components/ui/card";
import { CHAIN_DISPLAY_NAMES, type ChainName } from "@/lib/chains";

interface Props {
  chain: ChainName | null;
}

const formatTime = (iso: string | null): string =>
  iso ? `${new Date(iso).toLocaleString("en-GB", { timeZone: "UTC" })} UTC` : "no data";

const formatHeight = (h: string | null): string => (h ? `#${h}` : "—");

export default async function AsyncSyncCard({ chain }: Props) {
  const all = await getSyncWatermarks();

  if (chain !== null) {
    const w = all.find((x) => x.chain === chain) ?? {
      last_synced_height: null,
      last_synced_at: null,
    };
    return (
      <Card>
        <CardValue>{formatHeight(w.last_synced_height)}</CardValue>
        <CardSubtext>{formatTime(w.last_synced_at)}</CardSubtext>
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
              {formatTime(w.last_synced_at)}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
