# lib/

Shared infrastructure: auth, OpenAPI registry.

## Files

| File | Purpose |
|---|---|
| `auth/api-key.ts` | `assertApiKey(req)` — returns 401 `Response` on fail, `null` on pass |
| `auth/session.ts` | reserved for future cookie/session auth (not wired up) |
| `openapi.ts` | `registry` + `generateOpenApiDocument()` — emits OpenAPI 3.1 spec |

## auth/api-key.ts

```ts
const provided = req.headers.get('x-api-key') ?? '';
const expected = env.API_KEY;
const a = Buffer.from(provided);
const b = Buffer.from(expected);
if (a.length !== b.length || !timingSafeEqual(a, b)) return Response.json({ error: 'unauthorized' }, { status: 401 });
return null;
```

- Constant-time compare via `crypto.timingSafeEqual`.
- Length-mismatch path leaks key length minimally — acceptable for MVP. If high-stakes, hash both before compare.
- Single `API_KEY` env var; multi-key (per-customer) not yet implemented.
- Header name: `x-api-key` (lowercase-canonical per HTTP).

## openapi.ts

- `extendZodWithOpenApi(z)` MUST be called before any schema is registered. Without it, `.openapi()` is undefined at runtime.
- `OpenAPIRegistry` collects schemas + paths.
- `generateOpenApiDocument()` emits OpenAPI 3.1 doc consumed by `/api/openapi.json` route.
- Scalar UI at `/docs` reads that route.

## Adding a new endpoint to OpenAPI

```ts
registry.registerPath({
  method: 'get',
  path: '/api/v1/<resource>',
  summary: '...',
  tags: ['<group>'],
  request: { headers: z.object({ 'x-api-key': z.string() }), query: ... },
  responses: {
    200: { description: '...', content: { 'application/json': { schema: ... } } },
    401: { description: 'Unauthorized', content: { 'application/json': { schema: ErrorResponse } } },
  },
  security: [{ apiKey: [] }],
});
```

Register response shapes via `registry.register('Name', schema)` and reference the returned schema in `content`.
