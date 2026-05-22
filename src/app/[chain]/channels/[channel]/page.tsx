import Link from "next/link";
import { Suspense } from "react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listChannels } from "@/services/channels-service";
import { CHAIN_DISPLAY_NAMES, isChainName } from "@/lib/chains";
import PeriodTabs, {
  type Period,
} from "@/components/dashboard/period-tabs";
import DirectionToggle, {
  type Direction,
} from "@/components/dashboard/direction-toggle";
import AsyncTimeseries from "@/components/charts/async-timeseries";
import ChartSkeleton from "@/components/charts/chart-skeleton";
import AsyncChannelTransfers from "@/components/channels/async-channel-transfers";
import Card, { CardSubtext, CardValue } from "@/components/ui/card";
import Subtitle from "@/components/common/subtitle";
import LoadingBlock from "@/components/ui/loading-block";
import PendingSwitch from "@/components/layout/pending-switch";

export const dynamic = "force-dynamic";

interface RouteParams {
  chain: string;
  channel: string;
}

interface SearchParams {
  period?: string;
  direction?: string;
  p?: string;
}

const CHANNEL_RE = /^channel-\d+$/;
const PAGE_LIMIT = 10;

const periodLabel: Record<Period, string> = {
  "24h": "last 24h",
  "7d": "last 7 days",
  "30d": "last 30 days",
};

const isPeriod = (v: unknown): v is Period =>
  v === "24h" || v === "7d" || v === "30d";

const isDirection = (v: unknown): v is Direction =>
  v === "outgoing" || v === "incoming" || v === "both";

const formatCount = (n: number) =>
  n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const formatUsd = (s: string) => {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
};

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { chain, channel } = await params;
  if (!isChainName(chain)) return { title: "Crosschain IBC Indexer" };
  const decoded = decodeURIComponent(channel);
  return { title: `${CHAIN_DISPLAY_NAMES[chain]} · ${decoded}` };
}

export default async function ChannelDetailPage({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams: Promise<SearchParams>;
}) {
  const { chain, channel } = await params;
  if (!isChainName(chain)) notFound();
  const decoded = decodeURIComponent(channel);

  if (!CHANNEL_RE.test(decoded)) notFound();

  const sp = await searchParams;
  const period: Period = isPeriod(sp.period) ? sp.period : "24h";
  const direction: Direction = isDirection(sp.direction)
    ? sp.direction
    : "both";
  const pageNum = Math.max(1, parseInt(sp.p ?? "1", 10) || 1);
  const offset = (pageNum - 1) * PAGE_LIMIT;

  const channelsResult = await listChannels({
    direction,
    period,
    sort: "transfers",
    order: "desc",
    limit: 1000,
    offset: 0,
    chain,
  });

  const channelRow = channelsResult.data.find(
    (c) => c.channel_id_src === decoded,
  );

  if (!channelRow) notFound();

  const currentSearch = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string" && v) currentSearch.set(k, v);
  }
  if (!currentSearch.has("period")) currentSearch.set("period", period);
  if (!currentSearch.has("direction"))
    currentSearch.set("direction", direction);

  const k = `${chain}-${decoded}-${period}-${direction}`;
  const chainDisplayName = CHAIN_DISPLAY_NAMES[chain];
  const counterpartyName = channelRow.counterparty_chain_name
    ? `${channelRow.counterparty_chain_name.charAt(0).toUpperCase()}${channelRow.counterparty_chain_name.slice(1)}`
    : null;

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <Link
          href={`/${chain}/dashboard`}
          className="font-sfpro text-xs uppercase tracking-wide text-white/50 hover:text-highlight"
        >
          ‹ back to dashboard
        </Link>
        <h1 className="font-handjet text-highlight text-4xl tracking-wide uppercase">
          {chainDisplayName}
          {counterpartyName ? ` → ${counterpartyName}` : ""}
        </h1>
        <p className="font-sfpro text-sm text-white/60">
          {channelRow.channel_id_src} · port {channelRow.port_id_src}
          {channelRow.channel_id_dst
            ? ` · counterparty ${channelRow.channel_id_dst}`
            : ""}
          {channelRow.counterparty_chain_id
            ? ` (${channelRow.counterparty_chain_id})`
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Subtitle>Channel volume · {periodLabel[period]}</Subtitle>
          <PendingSwitch fallback={<LoadingBlock height="h-32" />}>
            <Card>
              <CardValue>${formatUsd(channelRow.volume_usd[period])}</CardValue>
              <CardSubtext>USD</CardSubtext>
            </Card>
          </PendingSwitch>
        </div>

        <div className="flex flex-col gap-3">
          <Subtitle>Channel packets · {periodLabel[period]}</Subtitle>
          <PendingSwitch fallback={<LoadingBlock height="h-32" />}>
            <Card>
              <CardValue>{formatCount(channelRow.transfers[period])}</CardValue>
              <CardSubtext>transfers</CardSubtext>
            </Card>
          </PendingSwitch>
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <Subtitle>
          Volume (USD) · {periodLabel[period]}
          <span className="font-sfpro ml-2 text-xs tracking-normal text-white/40 normal-case">
            (UTC)
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
                channelIdSrc={decoded}
                variant="full"
                chain={chain}
              />
            </PendingSwitch>
          </Suspense>
        </section>
      </div>

      <div className="flex flex-col gap-3">
        <Subtitle>
          Transfers · {periodLabel[period]}
          <span className="font-sfpro ml-2 text-xs tracking-normal text-white/40 normal-case">
            (UTC)
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
                channelIdSrc={decoded}
                variant="full"
                chain={chain}
              />
            </PendingSwitch>
          </Suspense>
        </section>
      </div>

      <div className="flex flex-col gap-3">
        <Subtitle>Recent packets · {periodLabel[period]}</Subtitle>
        <Suspense
          key={`packets-${k}-${pageNum}`}
          fallback={<LoadingBlock height="h-96" label="loading packets" />}
        >
          <PendingSwitch
            fallback={<LoadingBlock height="h-96" label="loading packets" />}
          >
            <AsyncChannelTransfers
              channelIdSrc={decoded}
              direction={direction}
              period={period}
              limit={PAGE_LIMIT}
              offset={offset}
              currentSearch={currentSearch}
              chain={chain}
            />
          </PendingSwitch>
        </Suspense>
      </div>
    </main>
  );
}
