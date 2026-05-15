import { db } from '@/db';
import logger from '@/logger';
import { errorResponse, okJson } from '@/lib/api-helpers';

export const dynamic = 'force-dynamic';

const log = logger('api/health');

export const GET = async (): Promise<Response> => {
  try {
    await db.$queryRaw`SELECT 1`;
    const cursor = await db.syncCursor.findUnique({ where: { key: 'ibc-transfers' } });
    return okJson(
      {
        ok: true,
        db_ready: true,
        last_synced_at: cursor?.updatedAt.toISOString() ?? null,
        last_synced_height: cursor?.lastEventHeight?.toString() ?? null,
      },
      'no-store',
    );
  } catch (e) {
    log.logError('health check failed', { error: (e as Error).message });
    return errorResponse('internal_error', 500);
  }
};
