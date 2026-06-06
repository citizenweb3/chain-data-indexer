# API v1 Routes

Next.js App Router Route Handlers. Each `route.ts` exports `GET` (no other verbs — read-only API).

## Endpoints

| Path | File | Auth | Schema |
|---|---|---|---|
| `GET /api/v1/health` | `health/route.ts` | no | runs `SELECT 1` |
| `GET /api/v1/blocks` | `blocks/route.ts` | yes | query: `BlocksQuerySchema` |
| `GET /api/v1/blocks/height/{h}` | `blocks/height/[h]/route.ts` | yes | param: `HeightParamSchema` |
| `GET /api/v1/blocks/stats` | `blocks/stats/route.ts` | yes | — |
| `GET /api/v1/txs` | `txs/route.ts` | yes | query: `TxsQuerySchema` |
| `GET /api/v1/txs/{hash}` | `txs/[hash]/route.ts` | yes | param: `HashParamSchema` |
| `GET /api/v1/txs/{hash}/raw` | `txs/[hash]/raw/route.ts` | yes | param: `HashParamSchema` |
| `GET /api/v1/txs/stats` | `txs/stats/route.ts` | yes | — |
| `GET /api/v1/ibc/transfers` | `ibc/transfers/route.ts` | yes | query: `IbcTransfersQuerySchema` |
| `GET /api/v1/ibc/transfers/{port}/{channel}/{sequence}` | `ibc/transfers/[port]/[channel]/[sequence]/route.ts` | yes | param: `IbcTransferParamSchema` |
| `GET /api/v1/gov/votes` | `gov/votes/route.ts` | yes | query: `GovVotesQuerySchema` |

## Standard handler shape

```ts
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: Promise<{ x: string }> }) {
  const authErr = assertApiKey(req);
  if (authErr) return authErr;

  const parsed = SomeSchema.safeParse(await params); // or req.url query
  if (!parsed.success) return errorResponse('invalid_params', 400, parsed.error.flatten().fieldErrors);

  try {
    const data = await someService(parsed.data);
    if (!data) return errorResponse('not_found', 404);
    return Response.json({ data }, { headers: cacheHeaders });
  } catch (err) {
    logger.error({ err }, 'context message');
    return errorResponse('internal_error', 500);
  }
}
```

## Rules

- `dynamic = 'force-dynamic'` is **required** when `req.headers` is read. Without it Next bails to static at build time → auth check disappears.
- `params` is a `Promise` in Next 16. `await` it.
- Auth-gated routes set `Cache-Control: private, max-age=N` + `Vary: x-api-key`. Never `public`.
- Detail/stable routes (`blocks/height/{h}`, `txs/{hash}`) use long max-age (1y, immutable). List/stats use short or zero.
- Errors: `errorResponse('invalid_params'|'unauthorized'|'not_found'|'internal_error', status, details?)`.
- Never log request bodies or `x-api-key` (logger redacts `req.headers.x-api-key` and `req.headers.authorization`).

## OpenAPI

Every new route MUST be registered in `src/lib/openapi.ts` via `registry.registerPath`. The Scalar UI at `/docs` reads from `/api/openapi.json` (11 paths registered).

## Adding a new endpoint

1. Define request schema in `src/schemas/`.
2. Add `queries/<resource>-queries.ts` SQL fn (returns BigInt natively).
3. Add `services/<resource>-service.ts` fn (converts BigInt → string).
4. Add `app/api/v1/<path>/route.ts` following standard shape.
5. Register OpenAPI path in `src/lib/openapi.ts`.
6. Run `gitnexus analyze .` + reindex deepcontext.
