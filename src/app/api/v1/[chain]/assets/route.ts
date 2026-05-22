import logger from '@/logger';
import { errorResponse, okJson, parseSearchParams } from '@/lib/api-helpers';
import { isChainName } from '@/lib/chains';
import { AssetsBreakdownQuerySchema } from '@/schemas/assets';
import { getAssetsBreakdown } from '@/services/assets-service';

export const dynamic = 'force-dynamic';

const log = logger('api/[chain]/assets');

export const GET = async (
  request: Request,
  ctx: { params: Promise<{ chain: string }> },
): Promise<Response> => {
  const { chain } = await ctx.params;
  if (!isChainName(chain)) return errorResponse('not_found', 404);

  const parsed = parseSearchParams(AssetsBreakdownQuerySchema, request);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await getAssetsBreakdown({
      direction: parsed.data.direction,
      period: parsed.data.period,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
      sort: parsed.data.sort,
      order: parsed.data.order,
      chain,
    });
    return okJson(result, 'public, max-age=30');
  } catch (e) {
    log.logError('assets failed', { chain, error: (e as Error).message });
    return errorResponse('internal_error', 500);
  }
};
