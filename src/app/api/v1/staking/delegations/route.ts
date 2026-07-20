import { errorResponse } from '@/errors';
import { assertApiKey } from '@/lib/auth/api-key';
import { logger } from '@/logger';
import { DelegationsQuerySchema } from '@/schemas/staking';
import { listDelegations } from '@/services/stake-service';

// Auth-gated validator delegation feed: reads x-api-key, so it must stay dynamic and private.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authErr = assertApiKey(req);
  if (authErr) return authErr;

  const url = new URL(req.url);
  const parsed = DelegationsQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return errorResponse('invalid_params', 400, parsed.error.flatten().fieldErrors);
  }

  const { validator, limit, sort, order, before_amount, before_height, before_index, before_msg_index } = parsed.data;
  const timeCursor =
    before_height !== undefined && before_index !== undefined && before_msg_index !== undefined
      ? {
          beforeHeight: before_height,
          beforeIndex: before_index,
          beforeMsgIndex: before_msg_index,
        }
      : undefined;

  try {
    const result =
      sort === 'amount'
        ? await listDelegations({
            validator,
            limit,
            sort,
            order,
            cursor:
              timeCursor && before_amount !== undefined ? { ...timeCursor, beforeAmount: before_amount } : undefined,
          })
        : await listDelegations({ validator, limit, sort, order, cursor: timeCursor });
    return Response.json(result, {
      headers: { 'Cache-Control': 'private, max-age=6', Vary: 'x-api-key' },
    });
  } catch (err) {
    logger.error({ err }, 'staking delegations list query failed');
    return errorResponse('internal_error', 500);
  }
}
