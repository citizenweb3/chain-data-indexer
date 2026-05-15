import { generateOpenApiDocument } from '@/lib/openapi';

export const dynamic = 'force-static';

let cached: string | null = null;

export const GET = (): Response => {
  if (cached === null) {
    cached = JSON.stringify(generateOpenApiDocument());
  }
  return new Response(cached, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=300',
    },
  });
};
