import { generateOpenApiDocument } from '@/lib/openapi';

export const dynamic = 'force-dynamic';

export function GET() {
  const doc = generateOpenApiDocument();
  return Response.json(doc);
}
