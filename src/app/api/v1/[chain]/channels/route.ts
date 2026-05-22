import logger from '@/logger';
import { errorResponse, okJson, parseSearchParams } from '@/lib/api-helpers';
import { isChainName } from '@/lib/chains';
import { ChannelsQuerySchema } from '@/schemas/channels';
import { listChannels } from '@/services/channels-service';

export const dynamic = 'force-dynamic';

const log = logger('api/[chain]/channels');

export const GET = async (
  request: Request,
  ctx: { params: Promise<{ chain: string }> },
): Promise<Response> => {
  const { chain } = await ctx.params;
  if (!isChainName(chain)) return errorResponse('not_found', 404);

  const parsed = parseSearchParams(ChannelsQuerySchema, request);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await listChannels({
      direction: parsed.data.direction,
      period: parsed.data.period,
      sort: parsed.data.sort,
      order: parsed.data.order,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      chain,
    });
    return okJson(result, 'public, max-age=30');
  } catch (e) {
    log.logError('channels failed', { chain, error: (e as Error).message });
    return errorResponse('internal_error', 500);
  }
};
