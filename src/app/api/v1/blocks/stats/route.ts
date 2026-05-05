export const dynamic = 'force-dynamic';

import { assertApiKey } from '@/lib/auth/api-key';
import { getBlocksStats } from '@/services/blocks-service';
import { errorResponse } from '@/errors';
import { logger } from '@/logger';

export async function GET(req: Request) {
  const authErr = assertApiKey(req);
  if (authErr) return authErr;

  try {
    const stats = await getBlocksStats();
    return Response.json(
      { data: stats },
      { headers: { 'Cache-Control': 'private, max-age=5', 'Vary': 'x-api-key' } },
    );
  } catch (err) {
    logger.error({ err }, 'blocks stats query failed');
    return errorResponse('internal_error', 500);
  }
}
