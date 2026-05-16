import { getStats } from "@/services/stats-service";
import { listChannels } from "@/services/channels-service";
import { getTimeseries } from "@/services/timeseries-service";
import PeriodTabs, {
  type Period,
} from "@/components/dashboard/period-tabs";
import DirectionToggle, {
  type Direction,
} from "@/components/dashboard/direction-toggle";
import StatsCards from "@/components/dashboard/stats-cards";
import TimeseriesLine from "@/components/charts/timeseries-line";
import ChannelsTable from "@/components/dashboard/channels-table";

export const dynamic = "force-dynamic";

interface SearchParams {
  period?: string;
  direction?: string;
  sort?: string;
  order?: "asc" | "desc";
  p?: string;
}

type ChannelSort = "transfers" | "volume_atom" | "last_activity";

const PAGE_LIMIT = 10;

const isPeriod = (v: unknown): v is Period =>
  v === "24h" || v === "7d" || v === "30d";

const isDirection = (v: unknown): v is Direction =>
  v === "outgoing" || v === "incoming" || v === "both";

const isChannelSort = (v: unknown): v is ChannelSort =>
  v === "transfers" || v === "volume_atom" || v === "last_activity";

const isOrder = (v: unknown): v is "asc" | "desc" =>
  v === "asc" || v === "desc";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const period: Period = isPeriod(sp.period) ? sp.period : "7d";
  const direction: Direction = isDirection(sp.direction)
    ? sp.direction
    : "both";
  const sort: ChannelSort = isChannelSort(sp.sort) ? sp.sort : "transfers";
  const order: "asc" | "desc" = isOrder(sp.order) ? sp.order : "desc";
  const pageNum = Math.max(1, parseInt(sp.p ?? "1", 10) || 1);
  const offset = (pageNum - 1) * PAGE_LIMIT;

  const currentSearch = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") currentSearch.set(k, v);
  }

  const [stats, channels, transfersSeries, atomSeries, usdSeries] =
    await Promise.all([
      getStats({ direction }),
      listChannels({
        direction,
        period,
        sort,
        order,
        limit: PAGE_LIMIT,
        offset,
      }),
      getTimeseries({ metric: "transfers", direction }),
      getTimeseries({ metric: "volume_atom", direction }),
      getTimeseries({ metric: "volume_usd", direction }),
    ]);

  const sparkRange = (points: { date: string; value: string }[]) =>
    points.slice(-7);

  const pageLength = Math.max(
    1,
    Math.ceil(channels.page.total / PAGE_LIMIT),
  );

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="font-handjet text-4xl tracking-wide text-highlight">
          Crosschain IBC Indexer
        </h1>
        <p className="font-sfpro text-sm text-white/70">
          ATOM IBC transfers · stats and per-channel breakdown.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <PeriodTabs defaultValue={period} />
        <DirectionToggle defaultValue={direction} />
        <span className="ml-auto font-sfpro text-xs text-white/40">
          as of {new Date(stats.as_of).toLocaleString("en-US")}
        </span>
      </div>

      <StatsCards
        stats={stats}
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

      <ChannelsTable
        channels={channels.data}
        period={period}
        pageLength={pageLength}
        currentSearch={currentSearch}
      />
    </main>
  );
}
