import logger from '@/logger';
import { errorResponse, okJson } from '@/lib/api-helpers';
import { getSyncWatermarks } from '@/services/health-service';

export const dynamic = 'force-dynamic';

const log = logger('api/health');

export const GET = async (): Promise<Response> => {
  try {
    const chains = await getSyncWatermarks();
    return okJson(
      {
        ok: true,
        db_ready: true,
        chains,
      },
      'no-store',
    );
  } catch (e) {
    log.logError('health check failed', { error: (e as Error).message });
    return errorResponse('internal_error', 500);
  }
};
