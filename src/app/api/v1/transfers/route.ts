import logger from '@/logger';
import { errorResponse, okJson, parseSearchParams } from '@/lib/api-helpers';
import { TransfersListQuerySchema } from '@/schemas/transfers';
import { listTransfers } from '@/services/transfers-service';

export const dynamic = 'force-dynamic';

const log = logger('api/transfers');

export const GET = async (request: Request): Promise<Response> => {
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
    });
    return okJson(result, 'public, max-age=10');
  } catch (e) {
    log.logError('transfers list failed', { error: (e as Error).message });
    return errorResponse('internal_error', 500);
  }
};
