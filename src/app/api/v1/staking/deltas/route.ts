import { errorResponse } from '@/errors';
import { assertApiKey } from '@/lib/auth/api-key';
import { logger } from '@/logger';
import { StakingDeltasQuerySchema } from '@/schemas/staking';
import { listStakingDeltas } from '@/services/staking-delta-service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authErr = assertApiKey(req);
  if (authErr) return authErr;

  const url = new URL(req.url);
  const parsed = StakingDeltasQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return errorResponse('invalid_params', 400, parsed.error.flatten().fieldErrors);
  }

  const { delegator, limit, before_height, before_index, before_msg_index } = parsed.data;
  try {
    const result = await listStakingDeltas({
      delegator,
      limit,
      beforeHeight: before_height,
      beforeIndex: before_index,
      beforeMsgIndex: before_msg_index,
    });
    return Response.json(result, {
      headers: { 'Cache-Control': 'private, max-age=6', Vary: 'x-api-key' },
    });
  } catch (err) {
    logger.error({ err }, 'staking deltas query failed');
    return errorResponse('internal_error', 500);
  }
}
