import { assertApiKey } from '@/lib/auth/api-key';
import { listGovVotesByVoter } from '@/services/gov-service';
import { GovVotesQuerySchema } from '@/schemas/gov';
import { errorResponse } from '@/errors';
import { logger } from '@/logger';

// Auth-gated route: reads req.headers (x-api-key), so it must be dynamic and never
// shared/static-cached. Private cache + Vary on x-api-key prevents cross-key reuse.
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const authErr = assertApiKey(req);
  if (authErr) return authErr;

  const url = new URL(req.url);
  const parsed = GovVotesQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return errorResponse('invalid_params', 400, parsed.error.flatten().fieldErrors);
  }

  const { voter, limit, before_proposal_id } = parsed.data;

  try {
    const result = await listGovVotesByVoter({
      voter,
      limit,
      beforeProposalId: before_proposal_id,
    });
    return Response.json(result, {
      headers: { 'Cache-Control': 'private, max-age=6', Vary: 'x-api-key' },
    });
  } catch (err) {
    logger.error({ err }, 'gov votes list query failed');
    return errorResponse('internal_error', 500);
  }
}
