import logger from '@/logger';
import { errorResponse, okJson, parseSearchParams } from '@/lib/api-helpers';
import { isChainName } from '@/lib/chains';
import { TransfersListQuerySchema } from '@/schemas/transfers';
import { listTransfers } from '@/services/transfers-service';

export const dynamic = 'force-dynamic';

const log = logger('api/[chain]/transfers');

export const GET = async (
  request: Request,
  ctx: { params: Promise<{ chain: string }> },
): Promise<Response> => {
  const { chain } = await ctx.params;
  if (!isChainName(chain)) return errorResponse('not_found', 404);

  const parsed = parseSearchParams(TransfersListQuerySchema, request);
  if (!parsed.ok) return parsed.response;

  try {
    const result = await listTransfers({
      limit: parsed.data.limit,
      beforeHeight: parsed.data.before_height,
      beforeSequence: parsed.data.before_sequence,
      beforeChannel: parsed.data.before_channel,
      beforePort: parsed.data.before_port,
      channelIdSrc: parsed.data.channel_id_src,
      direction: parsed.data.direction,
      status: parsed.data.status,
      denom: parsed.data.denom,
      denomBase: parsed.data.denom_base,
      chain,
    });
    return okJson(result, 'public, max-age=10');
  } catch (e) {
    log.logError('transfers list failed', { chain, error: (e as Error).message });
    return errorResponse('internal_error', 500);
  }
};
