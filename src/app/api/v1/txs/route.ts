import { assertApiKey } from '@/lib/auth/api-key';
import { listTxs } from '@/services/txs-service';
import { TxsQuerySchema } from '@/schemas/pagination';
import { errorResponse } from '@/errors';
import { logger } from '@/logger';

export const revalidate = 6;

export async function GET(req: Request) {
  const authErr = assertApiKey(req);
  if (authErr) return authErr;

  const url = new URL(req.url);
  const parsed = TxsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return errorResponse('invalid_params', 400, parsed.error.flatten().fieldErrors);
  }

  const { limit, before_height, before_index } = parsed.data;

  try {
    const result = await listTxs({ limit, beforeHeight: before_height, beforeIndex: before_index });
    return Response.json(result);
  } catch (err) {
    logger.error({ err }, 'txs list query failed');
    return errorResponse('internal_error', 500);
  }
}
