import { Suspense } from "react";
import type { Metadata } from "next";
import PeriodTabs, { type Period } from "@/components/dashboard/period-tabs";
import DirectionToggle, { type Direction } from "@/components/dashboard/direction-toggle";
import AsyncTimeseries from "@/components/charts/async-timeseries";
import ChartSkeleton from "@/components/charts/chart-skeleton";
import AsyncStatTiles from "@/components/dashboard/async-stat-tiles";
import ChainsTable from "@/components/dashboard/chains-table";
import Subtitle from "@/components/common/subtitle";
import LoadingBlock from "@/components/ui/loading-block";
import PendingSwitch from "@/components/layout/pending-switch";

export const dynamic = "force-dynamic";

interface SearchParams {
  period?: string;
  direction?: string;
}

const periodLabel: Record<Period, string> = {
  "24h": "last 24h",
  "7d": "last 7 days",
  "30d": "last 30 days",
};

const isPeriod = (v: unknown): v is Period => v === "24h" || v === "7d" || v === "30d";

const isDirection = (v: unknown): v is Direction =>
  v === "outgoing" || v === "incoming" || v === "both";

export const metadata: Metadata = {
  title: "Crosschain IBC stats",
};

export default async function CombinedDashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const sp = await searchParams;
  const period: Period = isPeriod(sp.period) ? sp.period : "24h";
  const direction: Direction = isDirection(sp.direction) ? sp.direction : "both";

  const k = `combined-${period}-${direction}`;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-10">
      <header className="flex flex-col gap-1">
        <h1 className="font-handjet text-highlight text-4xl tracking-wide uppercase">
          Crosschain IBC stats
        </h1>
        <p className="font-sfpro text-sm text-white/55">
          Aggregated across all indexed chains. Pick a chain below to drill in.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <PeriodTabs defaultValue={period} />
        <DirectionToggle defaultValue={direction} />
      </div>

      <Suspense
        key={`tiles-${k}`}
        fallback={<LoadingBlock height="h-28" />}
      >
        <PendingSwitch fallback={<LoadingBlock height="h-28" />}>
          <AsyncStatTiles direction={direction} period={period} />
        </PendingSwitch>
      </Suspense>

      <div className="flex flex-col gap-3">
        <Subtitle>Chains · {periodLabel[period]}</Subtitle>
        <Suspense
          key={`chains-${k}`}
          fallback={<LoadingBlock height="h-48" label="loading chains" />}
        >
          <PendingSwitch fallback={<LoadingBlock height="h-48" label="loading chains" />}>
            <ChainsTable direction={direction} period={period} />
          </PendingSwitch>
        </Suspense>
      </div>

      <div className="flex flex-col gap-3">
        <Subtitle>
          Volume (USD) · {periodLabel[period]}
          <span className="font-sfpro ml-2 text-xs tracking-normal text-white/40 normal-case">
            (UTC, all chains)
          </span>
        </Subtitle>
        <section className="border-bgSt bg-table_row border p-6">
          <Suspense
            key={`volume-${k}`}
            fallback={<ChartSkeleton variant="full" />}
          >
            <PendingSwitch fallback={<ChartSkeleton variant="full" />}>
              <AsyncTimeseries
                metric="volume_usd"
                period={period}
                direction={direction}
                variant="full"
                chain={null}
              />
            </PendingSwitch>
          </Suspense>
        </section>
      </div>

      <div className="flex flex-col gap-3">
        <Subtitle>
          Transfers · {periodLabel[period]}
          <span className="font-sfpro ml-2 text-xs tracking-normal text-white/40 normal-case">
            (UTC, all chains)
          </span>
        </Subtitle>
        <section className="border-bgSt bg-table_row border p-6">
          <Suspense
            key={`transfers-${k}`}
            fallback={<ChartSkeleton variant="full" />}
          >
            <PendingSwitch fallback={<ChartSkeleton variant="full" />}>
              <AsyncTimeseries
                metric="transfers"
                period={period}
                direction={direction}
                variant="full"
                chain={null}
              />
            </PendingSwitch>
          </Suspense>
        </section>
      </div>
    </main>
  );
}
