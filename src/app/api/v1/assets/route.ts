import logger from '@/logger';
import { errorResponse, okJson, parseSearchParams } from '@/lib/api-helpers';
import { AssetsBreakdownQuerySchema } from '@/schemas/assets';
import { getAssetsBreakdown } from '@/services/assets-service';

export const dynamic = 'force-dynamic';

const log = logger('api/assets');

export const GET = async (request: Request): Promise<Response> => {
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
    });
    return okJson(result, 'public, max-age=30');
  } catch (e) {
    log.logError('assets failed', { error: (e as Error).message });
    return errorResponse('internal_error', 500);
  }
};
