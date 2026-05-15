export const dynamic = 'force-dynamic';

import { assertApiKey } from '@/lib/auth/api-key';
import { getIbcTransfer } from '@/services/ibc-service';
import { IbcTransferParamSchema } from '@/schemas/ibc';
import { errorResponse } from '@/errors';
import { logger } from '@/logger';

const TERMINAL_STATUSES = new Set(['acknowledged', 'timeout', 'failed']);
const IMMUTABLE_CACHE = 'private, max-age=31536000, immutable';
const TRANSIENT_CACHE = 'private, max-age=10, must-revalidate';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ port: string; channel: string; sequence: string }> },
) {
  const authErr = assertApiKey(req);
  if (authErr) return authErr;

  const resolvedParams = await params;
  const parsed = IbcTransferParamSchema.safeParse(resolvedParams);
  if (!parsed.success) {
    return errorResponse('invalid_params', 400, parsed.error.flatten().fieldErrors);
  }

  try {
    const transfer = await getIbcTransfer(parsed.data);
    if (!transfer) return errorResponse('not_found', 404);

    const cacheControl = TERMINAL_STATUSES.has(transfer.status) ? IMMUTABLE_CACHE : TRANSIENT_CACHE;
    return Response.json(
      { data: transfer },
      { headers: { 'Cache-Control': cacheControl, 'Vary': 'x-api-key' } },
    );
  } catch (err) {
    logger.error(
      { err, port: resolvedParams.port, channel: resolvedParams.channel, sequence: resolvedParams.sequence },
      'ibc transfer detail query failed',
    );
    return errorResponse('internal_error', 500);
  }
}
