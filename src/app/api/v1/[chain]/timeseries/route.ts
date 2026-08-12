import logger from '@/logger';
import { errorResponse, okJson, parseSearchParams } from '@/lib/api-helpers';
import { isChainName } from '@/lib/chains';
import { TimeseriesChainQuerySchema } from '@/schemas/timeseries';
import { getTimeseries, getTimeseriesHourly } from '@/services/timeseries-service';

export const dynamic = 'force-dynamic';

const log = logger('api/[chain]/timeseries');

export const GET = async (
  request: Request,
  ctx: { params: Promise<{ chain: string }> },
): Promise<Response> => {
  const { chain } = await ctx.params;
  if (!isChainName(chain)) return errorResponse('not_found', 404);

  const parsed = parseSearchParams(TimeseriesChainQuerySchema, request);
  if (!parsed.ok) return parsed.response;

  try {
    const result =
      parsed.data.bucket === 'hour'
        ? await getTimeseriesHourly({
            metric: parsed.data.metric,
            direction: parsed.data.direction,
            channelIdSrc: parsed.data.channel_id_src,
            chain,
          })
        : await getTimeseries({
            metric: parsed.data.metric,
            direction: parsed.data.direction,
            from: parsed.data.from,
            to: parsed.data.to,
            channelIdSrc: parsed.data.channel_id_src,
            chain,
          });
    return okJson(result, 'public, max-age=60');
  } catch (e) {
    log.logError('timeseries failed', { chain, error: (e as Error).message });
    return errorResponse('internal_error', 500);
  }
};
