import { errorResponse } from '@/errors';
import { assertApiKey } from '@/lib/auth/api-key';
import { logger } from '@/logger';
import { getCoverage } from '@/services/address-service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authErr = assertApiKey(req);
  if (authErr) return authErr;

  try {
    const data = await getCoverage();
    if (!data) return errorResponse('not_found', 404);
    return Response.json({ data }, { headers: { 'Cache-Control': 'private, max-age=3600', Vary: 'x-api-key' } });
  } catch (err) {
    logger.error({ err }, 'coverage query failed');
    return errorResponse('internal_error', 500);
  }
}
