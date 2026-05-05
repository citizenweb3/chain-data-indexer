export const dynamic = 'force-dynamic';

import { assertApiKey } from '@/lib/auth/api-key';
import { getBlockByHeight } from '@/services/blocks-service';
import { HeightParamSchema } from '@/schemas/pagination';
import { errorResponse } from '@/errors';
import { logger } from '@/logger';

export async function GET(req: Request, { params }: { params: Promise<{ h: string }> }) {
  const authErr = assertApiKey(req);
  if (authErr) return authErr;

  const resolvedParams = await params;
  const parsed = HeightParamSchema.safeParse(resolvedParams);
  if (!parsed.success) {
    return errorResponse('invalid_params', 400, parsed.error.flatten().fieldErrors);
  }

  try {
    const block = await getBlockByHeight(parsed.data.h);
    if (!block) return errorResponse('not_found', 404);
    return Response.json(
      { data: block },
      { headers: { 'Cache-Control': 'private, max-age=31536000, immutable', 'Vary': 'x-api-key' } },
    );
  } catch (err) {
    logger.error({ err, height: String(parsed.data.h) }, 'block by height query failed');
    return errorResponse('internal_error', 500);
  }
}
