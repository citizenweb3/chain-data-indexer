import { assertApiKey } from '@/lib/auth/api-key';
import { listBlocks } from '@/services/blocks-service';
import { BlocksQuerySchema } from '@/schemas/pagination';
import { errorResponse } from '@/errors';
import { logger } from '@/logger';

export const revalidate = 6;

export async function GET(req: Request) {
  const authErr = assertApiKey(req);
  if (authErr) return authErr;

  const url = new URL(req.url);
  const parsed = BlocksQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return errorResponse('invalid_params', 400, parsed.error.flatten().fieldErrors);
  }

  const { limit, before_height } = parsed.data;

  try {
    const result = await listBlocks({ limit, beforeHeight: before_height });
    return Response.json(result);
  } catch (err) {
    logger.error({ err }, 'blocks list query failed');
    return errorResponse('internal_error', 500);
  }
}
