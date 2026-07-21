import { errorResponse } from '@/errors';
import { assertApiKey } from '@/lib/auth/api-key';
import { logger } from '@/logger';
import { TransfersByAddressQuerySchema } from '@/schemas/transfers';
import { listTransfersByAddress } from '@/services/transfers-service';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authErr = assertApiKey(req);
  if (authErr) return authErr;

  const url = new URL(req.url);
  const parsed = TransfersByAddressQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return errorResponse('invalid_params', 400, parsed.error.flatten().fieldErrors);
  }

  const { address, limit, before_height, before_tx_hash, before_msg_index, before_from, before_to, before_denom } =
    parsed.data;
  const cursor =
    before_height !== undefined &&
    before_tx_hash !== undefined &&
    before_msg_index !== undefined &&
    before_from !== undefined &&
    before_to !== undefined &&
    before_denom !== undefined
      ? {
          beforeHeight: before_height,
          beforeTxHash: before_tx_hash,
          beforeMsgIndex: before_msg_index,
          beforeFromAddr: before_from,
          beforeToAddr: before_to,
          beforeDenom: before_denom,
        }
      : undefined;

  try {
    const result = await listTransfersByAddress(address, limit, cursor);
    return Response.json(result, { headers: { 'Cache-Control': 'private, max-age=6', Vary: 'x-api-key' } });
  } catch (err) {
    logger.error({ err }, 'transfers by address query failed');
    return errorResponse('internal_error', 500);
  }
}
