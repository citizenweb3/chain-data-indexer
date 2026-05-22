import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  listTransfers,
  type TransferFilterDirection,
} from "@/services/transfers-service";
import { CHAIN_DISPLAY_NAMES, isChainName } from "@/lib/chains";
import TransfersTable from "@/components/transfers/transfers-table";
import PeriodTabs, {
  type Period,
} from "@/components/dashboard/period-tabs";
import DirectionToggle from "@/components/dashboard/direction-toggle";

export const dynamic = "force-dynamic";

interface RouteParams {
  chain: string;
}

interface SearchParams {
  period?: string;
  direction?: string;
  status?: string;
  channel?: string;
  denom?: string;
  denom_base?: string;
  p?: string;
}

type TransferStatus = "sent" | "received" | "acknowledged" | "timeout" | "failed";

const PAGE_LIMIT = 20;

const isPeriod = (v: unknown): v is Period =>
  v === "24h" || v === "7d" || v === "30d";

const isDirection = (v: unknown): v is TransferFilterDirection =>
  v === "outgoing" || v === "incoming" || v === "both";

const isStatus = (v: unknown): v is TransferStatus =>
  v === "sent" ||
  v === "received" ||
  v === "acknowledged" ||
  v === "timeout" ||
  v === "failed";

const periodLabel: Record<Period, string> = {
  "24h": "last 24h",
  "7d": "last 7 days",
  "30d": "last 30 days",
};

const periodToSince = (period: Period): Date => {
  const ms =
    period === "24h"
      ? 24 * 60 * 60 * 1000
      : period === "7d"
      ? 7 * 24 * 60 * 60 * 1000
      : 30 * 24 * 60 * 60 * 1000;
  return new Date(Date.now() - ms);
};

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { chain } = await params;
  if (!isChainName(chain)) return { title: "Crosschain IBC Indexer" };
  return { title: `${CHAIN_DISPLAY_NAMES[chain]} transfers` };
}

export default async function TransfersPage({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams: Promise<SearchParams>;
}) {
  const { chain } = await params;
  if (!isChainName(chain)) notFound();

  const sp = await searchParams;

  const period: Period = isPeriod(sp.period) ? sp.period : "24h";
  const direction: TransferFilterDirection = isDirection(sp.direction)
    ? sp.direction
    : "both";
  const status = isStatus(sp.status) ? sp.status : undefined;
  const channelIdSrc = sp.channel || undefined;
  const denom = sp.denom || undefined;
  const denomBase = !denom && sp.denom_base ? sp.denom_base : undefined;
  const pageNum = Math.max(1, parseInt(sp.p ?? "1", 10) || 1);
  const offset = (pageNum - 1) * PAGE_LIMIT;
  const since = periodToSince(period);

  const result = await listTransfers({
    limit: PAGE_LIMIT,
    direction,
    status,
    channelIdSrc,
    denom,
    denomBase,
    since,
    offset,
    chain,
  });

  const totalRows = Number(result.total);
  const pageLength = Math.max(
    1,
    Math.ceil((Number.isFinite(totalRows) ? totalRows : 0) / PAGE_LIMIT),
  );

  const currentSearch = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string" && v) currentSearch.set(k, v);
  }
  if (!currentSearch.has("period")) currentSearch.set("period", period);
  if (!currentSearch.has("direction")) currentSearch.set("direction", direction);

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="font-handjet text-4xl uppercase tracking-wide text-highlight">
          {CHAIN_DISPLAY_NAMES[chain]} IBC transfers
        </h1>
        <p className="font-sfpro text-sm text-white/60">
          {result.total} total · {periodLabel[period]} · page {pageNum} of {pageLength}
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <PeriodTabs defaultValue={period} />
        <DirectionToggle defaultValue={direction} />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="font-sfpro text-sm uppercase tracking-wide text-white/60">
          All packets
        </h2>
        <TransfersTable
          transfers={result.data}
          pageLength={pageLength}
          currentSearch={currentSearch}
          chain={chain}
        />
      </section>
    </main>
  );
}
