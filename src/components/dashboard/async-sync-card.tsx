import { getSyncWatermarks } from "@/services/health-service";
import Card, { CardSubtext, CardValue } from "@/components/ui/card";
import type { ChainName } from "@/lib/chains";

interface Props {
  chain: ChainName;
}

export default async function AsyncSyncCard({ chain }: Props) {
  const all = await getSyncWatermarks();
  const watermark =
    all.find((w) => w.chain === chain) ?? {
      last_synced_height: null,
      last_synced_at: null,
    };
  return (
    <Card>
      <CardValue>
        {watermark.last_synced_height
          ? `#${watermark.last_synced_height}`
          : "—"}
      </CardValue>
      <CardSubtext>
        {watermark.last_synced_at
          ? `${new Date(watermark.last_synced_at).toLocaleString("en-GB", { timeZone: "UTC" })} UTC`
          : "no data"}
      </CardSubtext>
    </Card>
  );
}
