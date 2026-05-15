import logger from '@/logger';
import { errorResponse, okJson, parseRouteParams } from '@/lib/api-helpers';
import { TransferParamSchema } from '@/schemas/transfers';
import { getTransfer } from '@/services/transfers-service';

export const dynamic = 'force-dynamic';

const log = logger('api/transfers/detail');

const FINALIZED = new Set(['acknowledged', 'timeout', 'failed']);

export const GET = async (
  _request: Request,
  ctx: { params: Promise<{ port: string; channel: string; sequence: string }> },
): Promise<Response> => {
  const rawParams = await ctx.params;
  const parsed = parseRouteParams(TransferParamSchema, rawParams);
  if (!parsed.ok) return parsed.response;

  try {
    const dto = await getTransfer({
      port: parsed.data.port,
      channel: parsed.data.channel,
      sequence: parsed.data.sequence,
    });
    if (!dto) return errorResponse('not_found', 404);

    const cache = FINALIZED.has(dto.status)
      ? 'public, max-age=86400'
      : 'public, max-age=60';
    return okJson({ data: dto }, cache);
  } catch (e) {
    log.logError('transfer detail failed', { error: (e as Error).message });
    return errorResponse('internal_error', 500);
  }
};
