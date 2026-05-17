import { getStats } from '@/services/stats-service';
import { listChannels } from '@/services/channels-service';
import { getAssetsBreakdown } from '@/services/assets-service';
import { getSyncWatermark } from '@/services/health-service';
import { getTimeseries, getTimeseriesHourly } from '@/services/timeseries-service';
import PeriodTabs, { type Period } from '@/components/dashboard/period-tabs';
import DirectionToggle, { type Direction } from '@/components/dashboard/direction-toggle';
import TopAssetsCard from '@/components/dashboard/top-assets-card';
import TimeseriesLine from '@/components/charts/timeseries-line';
import ChannelsTable from '@/components/dashboard/channels-table';
import Subtitle from '@/components/common/subtitle';
import Card, { CardSubtext, CardValue } from '@/components/ui/card';

export const dynamic = 'force-dynamic';

interface SearchParams {
  period?: string;
  direction?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  p?: string;
}

type ChannelSort = 'transfers' | 'volume_usd' | 'last_activity';

const PAGE_LIMIT = 10;
const MS_PER_DAY = 86_400_000;

const periodDays: Record<Period, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
};

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

const formatUsd = (s: string) => {
  const n = Number(s);
  if (!Number.isFinite(n)) return s;
  return n.toLocaleString('en-US', { maximumFractionDigits: 0 });
};

export default async function DashboardPage({ searchParams, }: { searchParams: Promise<SearchParams>; }) {
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

  const days = periodDays[period];
  const chartTo = new Date();
  const chartFrom = new Date(chartTo.getTime() - (days - 1) * MS_PER_DAY);

  const transfersChartPromise =
    period === '24h'
      ? getTimeseriesHourly({ metric: 'transfers', direction })
      : getTimeseries({
          metric: 'transfers',
          direction,
          from: chartFrom,
          to: chartTo,
        });

  const volumeUsdChartPromise =
    period === '24h'
      ? getTimeseriesHourly({ metric: 'volume_usd', direction })
      : getTimeseries({
          metric: 'volume_usd',
          direction,
          from: chartFrom,
          to: chartTo,
        });

  const [stats, channels, transfersSeries, volumeUsdSeries, assetsBreakdown, watermark] =
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
      transfersChartPromise,
      volumeUsdChartPromise,
      getAssetsBreakdown({ direction, period, limit: 5 }),
      getSyncWatermark(),
    ]);

  const pageLength = Math.max(1, Math.ceil(channels.page.total / PAGE_LIMIT));

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="font-handjet text-highlight text-4xl tracking-wide uppercase">
          Cosmos Hub IBC stats
        </h1>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <PeriodTabs defaultValue={period} />
        <DirectionToggle defaultValue={direction} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-3">
          <Subtitle>Cosmos Hub transfers · {periodLabel[period]}</Subtitle>
          <Card>
            <CardValue>${formatUsd(stats.volume_usd[period])}</CardValue>
            <CardSubtext>USD</CardSubtext>
          </Card>
        </div>

        <div className="flex flex-col gap-3">
          <Subtitle>Last sync</Subtitle>
          <Card>
            <CardValue>
              {watermark.last_synced_height ? `#${watermark.last_synced_height}` : '—'}
            </CardValue>
            <CardSubtext>
              {watermark.last_synced_at
                ? `${new Date(watermark.last_synced_at).toLocaleString('en-GB', { timeZone: 'UTC' })} UTC`
                : 'no data'}
            </CardSubtext>
          </Card>
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
          <TimeseriesLine data={volumeUsdSeries.data} metric="volume_usd" variant="full" />
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
          <TimeseriesLine data={transfersSeries.data} metric="transfers" variant="full" />
        </section>
      </div>

      <div className="flex flex-col gap-3">
        <Subtitle>Top assets · {periodLabel[period]}</Subtitle>
        <TopAssetsCard data={assetsBreakdown.data} period={period} direction={direction} />
      </div>

      <div className="flex flex-col gap-3">
        <Subtitle>Channels · {periodLabel[period]}</Subtitle>
        <ChannelsTable
          channels={channels.data}
          period={period}
          pageLength={pageLength}
          currentSearch={currentSearch}
        />
      </div>
    </main>
  );
}
