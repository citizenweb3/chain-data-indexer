import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getAssetsBreakdown } from "@/services/assets-service";
import type {
  AssetsSort,
  SortOrder,
} from "@/services/assets-service";
import { CHAIN_DISPLAY_NAMES, isChainName } from "@/lib/chains";
import PeriodTabs, {
  type Period,
} from "@/components/dashboard/period-tabs";
import DirectionToggle, {
  type Direction,
} from "@/components/dashboard/direction-toggle";
import AssetsTable from "@/components/assets/assets-table";

export const dynamic = "force-dynamic";

interface RouteParams {
  chain: string;
}

interface SearchParams {
  period?: string;
  direction?: string;
  sort?: string;
  order?: string;
  p?: string;
}

const PAGE_LIMIT = 20;

const isPeriod = (v: unknown): v is Period =>
  v === "24h" || v === "7d" || v === "30d";

const isDirection = (v: unknown): v is Direction =>
  v === "outgoing" || v === "incoming" || v === "both";

const isAssetsSort = (v: unknown): v is AssetsSort =>
  v === "transfers" || v === "volume_usd" || v === "share";

const isOrder = (v: unknown): v is SortOrder =>
  v === "asc" || v === "desc";

const periodLabel: Record<Period, string> = {
  "24h": "last 24h",
  "7d": "last 7 days",
  "30d": "last 30 days",
};

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { chain } = await params;
  if (!isChainName(chain)) return { title: "Crosschain IBC Indexer" };
  return { title: `${CHAIN_DISPLAY_NAMES[chain]} assets` };
}

export default async function AssetsPage({
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
  const direction: Direction = isDirection(sp.direction)
    ? sp.direction
    : "both";
  const sort: AssetsSort = isAssetsSort(sp.sort) ? sp.sort : "volume_usd";
  const order: SortOrder = isOrder(sp.order) ? sp.order : "desc";
  const pageNum = Math.max(1, parseInt(sp.p ?? "1", 10) || 1);
  const offset = (pageNum - 1) * PAGE_LIMIT;

  const currentSearch = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === "string") currentSearch.set(k, v);
  }

  const breakdown = await getAssetsBreakdown({
    direction,
    period,
    limit: PAGE_LIMIT,
    offset,
    sort,
    order,
    chain,
  });

  const totalUsd = Number(breakdown.totals.amount_usd);
  const totalTransfers = breakdown.totals.transfers_count;
  const pageLength = Math.max(
    1,
    Math.ceil(breakdown.page.total / PAGE_LIMIT),
  );

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-10">
      <p className="font-sfpro text-sm text-white/55">
        Per-asset transfer counts and volume · {periodLabel[period]}
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <PeriodTabs defaultValue={period} />
        <DirectionToggle defaultValue={direction} />
        <span className="ml-auto font-sfpro text-xs text-white/40">
          as of {new Date(breakdown.as_of).toLocaleString("en-GB", { timeZone: "UTC" })} UTC
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="border border-bgSt bg-table_row p-6 transition-colors duration-75 hover:bg-bgHover">
          <div className="font-sfpro text-xs uppercase tracking-wide text-white/60">
            Assets shown
          </div>
          <div className="mt-1 font-handjet text-4xl tracking-wide text-white">
            {breakdown.page.total}
          </div>
        </div>
        <div className="border border-bgSt bg-table_row p-6 transition-colors duration-75 hover:bg-bgHover">
          <div className="font-sfpro text-xs uppercase tracking-wide text-white/60">
            Total transfers
          </div>
          <div className="mt-1 font-handjet text-4xl tracking-wide text-white">
            {totalTransfers.toLocaleString("en-US")}
          </div>
        </div>
        <div className="border border-bgSt bg-table_row p-6 transition-colors duration-75 hover:bg-bgHover">
          <div className="font-sfpro text-xs uppercase tracking-wide text-white/60">
            Total volume (USD)
          </div>
          <div className="mt-1 font-handjet text-4xl tracking-wide text-secondary">
            $
            {Number.isFinite(totalUsd)
              ? totalUsd.toLocaleString("en-US", { maximumFractionDigits: 0 })
              : breakdown.totals.amount_usd}
          </div>
        </div>
      </div>

      <AssetsTable
        assets={breakdown.data}
        totalUsd={Number.isFinite(totalUsd) ? totalUsd : 0}
        startRank={offset + 1}
        pageLength={pageLength}
        currentSearch={currentSearch}
      />
    </main>
  );
}
