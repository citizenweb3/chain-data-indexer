import Link from "next/link";
import { notFound } from "next/navigation";
import { listChannels } from "@/services/channels-service";
import { getTimeseries } from "@/services/timeseries-service";
import { listTransfers } from "@/services/transfers-service";
import PeriodTabs, {
  type Period,
} from "@/components/dashboard/period-tabs";
import DirectionToggle, {
  type Direction,
} from "@/components/dashboard/direction-toggle";
import StatsCards, {
  type StatsDto,
} from "@/components/dashboard/stats-cards";
import TimeseriesLine from "@/components/charts/timeseries-line";
import TransfersTable from "@/components/transfers/transfers-table";

export const dynamic = "force-dynamic";

interface RouteParams {
  channel: string;
}

interface SearchParams {
  period?: string;
  direction?: string;
}

const CHANNEL_RE = /^channel-\d+$/;

const isPeriod = (v: unknown): v is Period =>
  v === "24h" || v === "7d" || v === "30d";

const isDirection = (v: unknown): v is Direction =>
  v === "outgoing" || v === "incoming" || v === "both";

const sparkRange = (points: { date: string; value: string }[]) =>
  points.slice(-7);

const RECENT_LIMIT = 10;

export default async function ChannelDetailPage({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams: Promise<SearchParams>;
}) {
  const { channel } = await params;
  const decoded = decodeURIComponent(channel);

  if (!CHANNEL_RE.test(decoded)) notFound();

  const sp = await searchParams;
  const period: Period = isPeriod(sp.period) ? sp.period : "7d";
  const direction: Direction = isDirection(sp.direction)
    ? sp.direction
    : "both";

  const [channelsResult, transfersSeries, atomSeries, usdSeries, recent] =
    await Promise.all([
      listChannels({
        direction,
        period,
        sort: "transfers",
        order: "desc",
        limit: 1000,
        offset: 0,
      }),
      getTimeseries({
        metric: "transfers",
        direction,
        channelIdSrc: decoded,
      }),
      getTimeseries({
        metric: "volume_atom",
        direction,
        channelIdSrc: decoded,
      }),
      getTimeseries({
        metric: "volume_usd",
        direction,
        channelIdSrc: decoded,
      }),
      listTransfers({
        limit: RECENT_LIMIT,
        channelIdSrc: decoded,
        direction: direction === "both" ? undefined : direction,
      }),
    ]);

  const channelRow = channelsResult.data.find(
    (c) => c.channel_id_src === decoded,
  );

  if (!channelRow) notFound();

  const channelStats: StatsDto = {
    transfers_count: channelRow.transfers,
    volume_atom: channelRow.volume_atom,
    volume_usd: channelRow.volume_usd,
    as_of: new Date().toISOString(),
  };

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <Link
          href="/dashboard"
          className="font-sfpro text-xs uppercase tracking-wide text-white/50 hover:text-highlight"
        >
          ‹ back to dashboard
        </Link>
        <h1 className="font-handjet text-4xl tracking-wide text-highlight">
          {channelRow.channel_id_src}
        </h1>
        <p className="font-sfpro text-sm text-white/70">
          port {channelRow.port_id_src}
          {channelRow.channel_id_dst
            ? ` · counterparty ${channelRow.channel_id_dst}`
            : ""}
          {channelRow.success_rate_30d !== null
            ? ` · success ${(channelRow.success_rate_30d * 100).toFixed(1)}% (30d)`
            : ""}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <PeriodTabs defaultValue={period} />
        <DirectionToggle defaultValue={direction} />
      </div>

      <StatsCards
        stats={channelStats}
        period={period}
        sparklines={{
          transfers: (
            <TimeseriesLine
              data={sparkRange(transfersSeries.data)}
              metric="transfers"
              variant="card"
            />
          ),
          volumeAtom: (
            <TimeseriesLine
              data={sparkRange(atomSeries.data)}
              metric="volume_atom"
              variant="card"
            />
          ),
          volumeUsd: (
            <TimeseriesLine
              data={sparkRange(usdSeries.data)}
              metric="volume_usd"
              variant="card"
            />
          ),
        }}
      />

      <section className="rounded-md border border-bgSt bg-card p-5">
        <h2 className="mb-3 font-sfpro text-sm uppercase tracking-wide text-white/60">
          Transfers · last 30 days
        </h2>
        <TimeseriesLine
          data={transfersSeries.data}
          metric="transfers"
          variant="full"
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="font-sfpro text-sm uppercase tracking-wide text-white/60">
          Recent packets
        </h2>
        <TransfersTable transfers={recent.data} />
        <div className="flex justify-end">
          <Link
            href={`/transfers?channel=${encodeURIComponent(decoded)}${
              direction !== "both" ? `&direction=${direction}` : ""
            }`}
            className="border-b border-bgSt px-2 font-handjet text-base hover:border-highlight hover:text-highlight"
          >
            All packets for this channel ›
          </Link>
        </div>
      </section>
    </main>
  );
}
