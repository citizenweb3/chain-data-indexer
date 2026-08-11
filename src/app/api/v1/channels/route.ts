import logger from '@/logger';
import { errorResponse, okJson, parseSearchParams } from '@/lib/api-helpers';
import { ChannelsCombinedQuerySchema } from '@/schemas/channels';
import { listChannels } from '@/services/channels-service';

export const dynamic = 'force-dynamic';

const log = logger('api/channels');

export const GET = async (request: Request): Promise<Response> => {
  const parsed = parseSearchParams(ChannelsCombinedQuerySchema, request);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await listChannels({
      direction: parsed.data.direction,
      period: parsed.data.period,
      sort: parsed.data.sort,
      order: parsed.data.order,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      chain: null,
    });
    return okJson(result, 'public, max-age=30');
  } catch (e) {
    log.logError('channels failed', { error: (e as Error).message });
    return errorResponse('internal_error', 500);
  }
};
