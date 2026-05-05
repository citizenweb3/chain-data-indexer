export const dynamic = 'force-dynamic';

import { assertApiKey } from '@/lib/auth/api-key';
import { getTxsStats } from '@/services/txs-service';
import { errorResponse } from '@/errors';
import { logger } from '@/logger';

export async function GET(req: Request) {
  const authErr = assertApiKey(req);
  if (authErr) return authErr;

  try {
    const stats = await getTxsStats();
    return Response.json(
      { data: stats },
      { headers: { 'Cache-Control': 'private, max-age=30', 'Vary': 'x-api-key' } },
    );
  } catch (err) {
    logger.error({ err }, 'txs stats query failed');
    return errorResponse('internal_error', 500);
  }
}
