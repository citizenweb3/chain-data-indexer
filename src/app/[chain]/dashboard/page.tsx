import { Suspense } from 'react';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CHAIN_DISPLAY_NAMES, isChainName } from '@/lib/chains';
import PeriodTabs, { type Period } from '@/components/dashboard/period-tabs';
import DirectionToggle, { type Direction } from '@/components/dashboard/direction-toggle';
import AsyncTimeseries from '@/components/charts/async-timeseries';
import ChartSkeleton from '@/components/charts/chart-skeleton';
import AsyncChannelsTable from '@/components/dashboard/async-channels-table';
import AsyncTopStatCard from '@/components/dashboard/async-top-stat-card';
import AsyncSyncCard from '@/components/dashboard/async-sync-card';
import AsyncTopAssets from '@/components/dashboard/async-top-assets';
import Subtitle from '@/components/common/subtitle';
import LoadingBlock from '@/components/ui/loading-block';
import PendingSwitch from '@/components/layout/pending-switch';

export const dynamic = 'force-dynamic';

interface RouteParams {
  chain: string;
}

interface SearchParams {
  period?: string;
  direction?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  p?: string;
}

type ChannelSort = 'transfers' | 'volume_usd' | 'last_activity';

const PAGE_LIMIT = 10;

const periodLabel: Record<Period, string> = {
  '24h': 'last 24h',
  '7d': 'last 7 days',
  '30d': 'last 30 days',
};

const isPeriod = (v: unknown): v is Period => v === '24h' || v === '7d' || v === '30d';

const isDirection = (v: unknown): v is Direction =>
  v === 'outgoing' || v === 'incoming' || v === 'both';

const isChannelSort = (v: unknown): v is ChannelSort =>
  v === 'transfers' || v === 'volume_usd' || v === 'last_activity';

const isOrder = (v: unknown): v is 'asc' | 'desc' => v === 'asc' || v === 'desc';

export async function generateMetadata({
  params,
}: {
  params: Promise<RouteParams>;
}): Promise<Metadata> {
  const { chain } = await params;
  if (!isChainName(chain)) return { title: 'Crosschain IBC Indexer' };
  return { title: `${CHAIN_DISPLAY_NAMES[chain]} IBC stats` };
}

export default async function DashboardPage({
  params,
  searchParams,
}: {
  params: Promise<RouteParams>;
  searchParams: Promise<SearchParams>;
}) {
  const { chain } = await params;
  if (!isChainName(chain)) notFound();

  const sp = await searchParams;
  const period: Period = isPeriod(sp.period) ? sp.period : '24h';
  const direction: Direction = isDirection(sp.direction) ? sp.direction : 'both';
  const sort: ChannelSort = isChannelSort(sp.sort) ? sp.sort : 'volume_usd';
  const order: 'asc' | 'desc' = isOrder(sp.order) ? sp.order : 'desc';
  const pageNum = Math.max(1, parseInt(sp.p ?? '1', 10) || 1);
  const offset = (pageNum - 1) * PAGE_LIMIT;

  const currentSearch = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') currentSearch.set(k, v);
  }

  const k = `${chain}-${period}-${direction}`;
  const chainDisplayName = CHAIN_DISPLAY_NAMES[chain];

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-10">
      <div className="flex flex-wrap items-center gap-3">
        <PeriodTabs defaultValue={period} />
        <DirectionToggle defaultValue={direction} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Subtitle>{chainDisplayName} transfers · {periodLabel[period]}</Subtitle>
          <Suspense
            key={`stat-${k}`}
            fallback={<LoadingBlock height="h-32" />}
          >
            <PendingSwitch fallback={<LoadingBlock height="h-32" />}>
              <AsyncTopStatCard direction={direction} period={period} chain={chain} />
            </PendingSwitch>
          </Suspense>
        </div>

        <div className="flex flex-col gap-3">
          <Subtitle>Last sync</Subtitle>
          <Suspense fallback={<LoadingBlock height="h-32" />}>
            <PendingSwitch fallback={<LoadingBlock height="h-32" />}>
              <AsyncSyncCard chain={chain} />
            </PendingSwitch>
          </Suspense>
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
                variant="full"
                chain={chain}
              />
            </PendingSwitch>
          </Suspense>
        </section>
      </div>

      <div className="flex flex-col gap-3">
        <Subtitle>Top assets · {periodLabel[period]}</Subtitle>
        <Suspense
          key={`assets-${k}`}
          fallback={<LoadingBlock height="h-48" label="loading assets" />}
        >
          <PendingSwitch
            fallback={<LoadingBlock height="h-48" label="loading assets" />}
          >
            <AsyncTopAssets direction={direction} period={period} chain={chain} />
          </PendingSwitch>
        </Suspense>
      </div>

      <div className="flex flex-col gap-3">
        <Subtitle>Channels · {periodLabel[period]}</Subtitle>
        <Suspense
          key={`channels-${k}-${sort}-${order}-${pageNum}`}
          fallback={<LoadingBlock height="h-96" label="loading channels" />}
        >
          <PendingSwitch
            fallback={<LoadingBlock height="h-96" label="loading channels" />}
          >
            <AsyncChannelsTable
              direction={direction}
              period={period}
              sort={sort}
              order={order}
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
