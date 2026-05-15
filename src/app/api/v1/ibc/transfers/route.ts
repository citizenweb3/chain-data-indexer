import { assertApiKey } from '@/lib/auth/api-key';
import { listIbcTransfers } from '@/services/ibc-service';
import { IbcTransfersQuerySchema } from '@/schemas/ibc';
import { errorResponse } from '@/errors';
import { logger } from '@/logger';

export const revalidate = 6;

export async function GET(req: Request) {
  const authErr = assertApiKey(req);
  if (authErr) return authErr;

  const url = new URL(req.url);
  const parsed = IbcTransfersQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return errorResponse('invalid_params', 400, parsed.error.flatten().fieldErrors);
  }

  const { limit, before_height, before_sequence, before_channel, before_port } = parsed.data;

  try {
    const result = await listIbcTransfers({
      limit,
      beforeHeight: before_height,
      beforeSequence: before_sequence,
      beforeChannel: before_channel,
      beforePort: before_port,
    });
    return Response.json(result);
  } catch (err) {
    logger.error({ err }, 'ibc transfers list query failed');
    return errorResponse('internal_error', 500);
  }
}
