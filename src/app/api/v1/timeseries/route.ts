import logger from '@/logger';
import { errorResponse, okJson, parseSearchParams } from '@/lib/api-helpers';
import { TimeseriesQuerySchema } from '@/schemas/timeseries';
import { getTimeseries, getTimeseriesHourly } from '@/services/timeseries-service';

export const dynamic = 'force-dynamic';

const log = logger('api/timeseries');

export const GET = async (request: Request): Promise<Response> => {
  const parsed = parseSearchParams(TimeseriesQuerySchema, request);
  if (!parsed.ok) return parsed.response;

  try {
    const result =
      parsed.data.bucket === 'hour'
        ? await getTimeseriesHourly({
            metric: parsed.data.metric,
            direction: parsed.data.direction,
            channelIdSrc: parsed.data.channel_id_src,
          })
        : await getTimeseries({
            metric: parsed.data.metric,
            direction: parsed.data.direction,
            from: parsed.data.from,
            to: parsed.data.to,
            channelIdSrc: parsed.data.channel_id_src,
          });
    return okJson(result, 'public, max-age=60');
  } catch (e) {
    log.logError('timeseries failed', { error: (e as Error).message });
    return errorResponse('internal_error', 500);
  }
};
