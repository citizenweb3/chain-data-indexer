import logger from '@/logger';
import { errorResponse, okJson, parseSearchParams } from '@/lib/api-helpers';
import { StatsQuerySchema } from '@/schemas/stats';
import { getStats } from '@/services/stats-service';

export const dynamic = 'force-dynamic';

const log = logger('api/stats');

export const GET = async (request: Request): Promise<Response> => {
  const parsed = parseSearchParams(StatsQuerySchema, request);
  if (!parsed.ok) return parsed.response;

  try {
    const data = await getStats({ direction: parsed.data.direction });
    return okJson({ data }, 'public, max-age=30');
  } catch (e) {
    log.logError('stats failed', { error: (e as Error).message });
    return errorResponse('internal_error', 500);
  }
};
