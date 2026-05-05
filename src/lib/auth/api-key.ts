import { timingSafeEqual } from 'node:crypto';
import { env } from '@/env';

export function assertApiKey(req: Request): Response | null {
  const provided = req.headers.get('x-api-key') ?? '';
  const expected = env.API_KEY;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  return null;
}
