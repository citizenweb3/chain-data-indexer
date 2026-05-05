import { db } from '@/db/indexer-db';
import { logger } from '@/logger';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await db`SELECT 1`;
    return Response.json({ status: 'ok' });
  } catch (err) {
    logger.error({ err }, 'health check failed');
    return Response.json({ status: 'degraded' }, { status: 503 });
  }
}
