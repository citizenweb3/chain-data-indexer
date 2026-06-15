import { assertApiKey } from '@/lib/auth/api-key';
import { listTxsByAddress } from '@/services/txs-service';
import { TxsByAddressQuerySchema } from '@/schemas/txs';
import { errorResponse } from '@/errors';
import { logger } from '@/logger';

// Auth-gated, per-address feed: must be dynamic and never shared/static-cached. Private cache
// + Vary on x-api-key prevents cross-key reuse. (The global /txs stays revalidate-cached.)
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authErr = assertApiKey(req);
  if (authErr) return authErr;

  const url = new URL(req.url);
  const parsed = TxsByAddressQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return errorResponse('invalid_params', 400, parsed.error.flatten().fieldErrors);
  }

  const { address: addresses, limit, before_height, before_index } = parsed.data;

  try {
    const result = await listTxsByAddress({
      addresses,
      limit,
      beforeHeight: before_height,
      beforeIndex: before_index,
    });
    return Response.json(result, {
      headers: { 'Cache-Control': 'private, max-age=6', Vary: 'x-api-key' },
    });
  } catch (err) {
    logger.error({ err }, 'txs by-address list query failed');
    return errorResponse('internal_error', 500);
  }
}
