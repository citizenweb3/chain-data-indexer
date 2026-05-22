import logger from '@/logger';
import { errorResponse, okJson, parseSearchParams } from '@/lib/api-helpers';
import { isChainName } from '@/lib/chains';
import { StatsQuerySchema } from '@/schemas/stats';
import { getStats } from '@/services/stats-service';

export const dynamic = 'force-dynamic';

const log = logger('api/[chain]/stats');

export const GET = async (
  request: Request,
  ctx: { params: Promise<{ chain: string }> },
): Promise<Response> => {
  const { chain } = await ctx.params;
  if (!isChainName(chain)) return errorResponse('not_found', 404);

  const parsed = parseSearchParams(StatsQuerySchema, request);
  if (!parsed.ok) return parsed.response;

  try {
    const data = await getStats({ direction: parsed.data.direction, chain });
    return okJson({ data }, 'public, max-age=30');
  } catch (e) {
    log.logError('stats failed', { chain, error: (e as Error).message });
    return errorResponse('internal_error', 500);
  }
};
