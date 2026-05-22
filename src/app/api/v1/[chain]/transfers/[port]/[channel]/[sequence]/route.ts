import logger from '@/logger';
import { errorResponse, okJson, parseRouteParams } from '@/lib/api-helpers';
import { isChainName } from '@/lib/chains';
import { TransferParamSchema } from '@/schemas/transfers';
import { getTransfer } from '@/services/transfers-service';

export const dynamic = 'force-dynamic';

const log = logger('api/[chain]/transfers/detail');

const FINALIZED = new Set(['acknowledged', 'timeout', 'failed']);

export const GET = async (
  _request: Request,
  ctx: {
    params: Promise<{ chain: string; port: string; channel: string; sequence: string }>;
  },
): Promise<Response> => {
  const rawParams = await ctx.params;
  const { chain, ...rest } = rawParams;
  if (!isChainName(chain)) return errorResponse('not_found', 404);

  const parsed = parseRouteParams(TransferParamSchema, rest);
  if (!parsed.ok) return parsed.response;

  try {
    const dto = await getTransfer({
      port: parsed.data.port,
      channel: parsed.data.channel,
      sequence: parsed.data.sequence,
      chain,
    });
    if (!dto) return errorResponse('not_found', 404);

    const cache = FINALIZED.has(dto.status)
      ? 'public, max-age=86400'
      : 'public, max-age=60';
    return okJson({ data: dto }, cache);
  } catch (e) {
    log.logError('transfer detail failed', { chain, error: (e as Error).message });
    return errorResponse('internal_error', 500);
  }
};
