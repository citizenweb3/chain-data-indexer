import { getTimeseries, getTimeseriesHourly } from '@/services/timeseries-service';
import TimeseriesLine from '@/components/charts/timeseries-line';
import type { ChartMetric, ChartVariant } from '@/components/charts/chart-config';
import type { Period } from '@/components/dashboard/period-tabs';
import type { Direction } from '@/components/dashboard/direction-toggle';
import type { ChainName } from '@/lib/chains';
import CoverageDisclosure, {
  summarizeCoverageStatuses,
} from '@/components/common/coverage-disclosure';
import type { TimeseriesResult } from '@/services/timeseries-service';

const MS_PER_DAY = 86_400_000;

const periodDays: Record<Period, number> = {
  '24h': 1,
  '7d': 7,
  '30d': 30,
};

interface AsyncTimeseriesProps {
  metric: ChartMetric;
  period: Period;
  direction: Direction;
  variant?: ChartVariant;
  channelIdSrc?: string;
  sliceTail?: number;
  forceDaily?: boolean;
  chain: ChainName | null;
}

export default async function AsyncTimeseries({
  metric,
  period,
  direction,
  variant = 'full',
  channelIdSrc,
  sliceTail,
  forceDaily = false,
  chain,
}: AsyncTimeseriesProps) {
  const useHourly = !forceDaily && period === '24h';
  let result: TimeseriesResult;
  if (useHourly) {
    result = await getTimeseriesHourly({
      metric,
      direction,
      channelIdSrc,
      chain,
    });
  } else {
    const days = periodDays[period];
    const to = new Date();
    const from = new Date(to.getTime() - (days - 1) * MS_PER_DAY);
    result = await getTimeseries({
      metric,
      direction,
      from,
      to,
      channelIdSrc,
      chain,
    });
  }
  let points = result.data;
  if (sliceTail !== undefined) points = points.slice(-sliceTail);
  const coverage = summarizeCoverageStatuses(points);
  return (
    <div className="flex flex-col gap-3">
      <TimeseriesLine data={points} metric={metric} variant={variant} />
      {variant === 'full' ? (
        <CoverageDisclosure status={coverage} sources={result.sources} compact />
      ) : null}
    </div>
  );
}
