export const dynamic = 'force-dynamic';

import { assertApiKey } from '@/lib/auth/api-key';
import { getTxDetail } from '@/services/txs-service';
import { HashParamSchema } from '@/schemas/pagination';
import { errorResponse } from '@/errors';
import { logger } from '@/logger';

export async function GET(req: Request, { params }: { params: Promise<{ hash: string }> }) {
  const authErr = assertApiKey(req);
  if (authErr) return authErr;

  const resolvedParams = await params;
  const parsed = HashParamSchema.safeParse(resolvedParams);
  if (!parsed.success) {
    return errorResponse('invalid_params', 400, parsed.error.flatten().fieldErrors);
  }

  try {
    const tx = await getTxDetail(parsed.data.hash);
    if (!tx) return errorResponse('not_found', 404);
    return Response.json(
      { data: tx },
      { headers: { 'Cache-Control': 'private, max-age=31536000, immutable', 'Vary': 'x-api-key' } },
    );
  } catch (err) {
    logger.error({ err, hash: parsed.data.hash }, 'tx detail query failed');
    return errorResponse('internal_error', 500);
  }
}
