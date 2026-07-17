import { errorResponse } from '@/errors';
import { assertApiKey } from '@/lib/auth/api-key';
import { logger } from '@/logger';
import { EarliestActivityQuerySchema } from '@/schemas/address';
import { getEarliestActivity } from '@/services/address-service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authErr = assertApiKey(req);
  if (authErr) return authErr;

  const url = new URL(req.url);
  const parsed = EarliestActivityQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return errorResponse('invalid_params', 400, parsed.error.flatten().fieldErrors);
  }

  try {
    const data = await getEarliestActivity(parsed.data.address);
    if (!data) return errorResponse('not_found', 404);
    return Response.json({ data }, { headers: { 'Cache-Control': 'private, max-age=3600', Vary: 'x-api-key' } });
  } catch (err) {
    logger.error({ err }, 'address earliest activity query failed');
    return errorResponse('internal_error', 500);
  }
}
