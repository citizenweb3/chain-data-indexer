import { getSyncWatermarks } from "@/services/health-service";
import Card, { CardSubtext, CardValue } from "@/components/ui/card";

export default async function AsyncSyncCard() {
  const all = await getSyncWatermarks();
  const watermark = all[0] ?? { last_synced_height: null, last_synced_at: null };
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
