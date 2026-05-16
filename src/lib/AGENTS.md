# src/lib/

Cross-cutting infrastructure shared by the API route handlers, RSC pages, and the OpenAPI generator. Nothing here is feature-specific.

## Files

| File | Purpose |
|------|---------|
| `openapi-zod.ts` | Patched `z` export — the **only** place `extendZodWithOpenApi` is called |
| `openapi.ts` | OpenAPI 3.1 registry + `generateOpenApiDocument()` for `/api/openapi.json` |
| `api-helpers.ts` | `parseSearchParams` / `parseRouteParams` / `errorResponse` / `okJson` |

## `openapi-zod.ts` — the Zod hoisting trick

Three lines, load-bearing:

```ts
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';
extendZodWithOpenApi(z);
export { z };
```

Why this file exists: `extendZodWithOpenApi` mutates the imported `z` namespace once, in place. If two modules import `z` from `'zod'` independently and Turbopack resolves them through two different module graphs (RSC, Edge, route handler, generator), each gets a **separate** instance — the patch applied in one graph is invisible to the other.

By centralizing the patch in `@/lib/openapi-zod` and importing `z` from there everywhere (schemas, registry, helpers), the resolution graph collapses to one. The patched `z` is the only `z` the project ever uses.

**Do not** import `z` directly from `'zod'` anywhere except in this file. The lint-by-eye rule: if you see `from 'zod'` in any `src/schemas/*` or `src/lib/openapi.ts`, that is a bug.

If `.openapi()` ever throws `is not a function`, or the schemas in `/api/openapi.json` show up as anonymous inline objects instead of `$ref`s, the dual-instance issue is back.

## `openapi.ts` — the registry

Single source of truth for the OpenAPI 3.1 document.

Pattern per response schema:

```ts
registry.register('StatsResponse', StatsResponseSchema);
```

This produces `#/components/schemas/StatsResponse` and lets `registerPath(...)` reference it by name. We do this for every public response (`ErrorResponse`, `StatsResponse`, `ChannelsResponse`, `TimeseriesResponse`, `TransfersListResponse`, `TransferDetailResponse`). Request query schemas are inlined per-path on purpose — they are rarely reused.

The error envelopes `error400` / `error500` are constants that reference `ErrorResponse` via `$ref` to keep paths terse.

`generateOpenApiDocument()` is called once per process and the result is cached as a string in `src/app/api/openapi.json/route.ts`. Don't `await` it at module top-level — call it lazily inside the route handler.

**Adding a new endpoint:** register the response schema, then call `registry.registerPath({ method, path, request: { query | params }, responses })`. The path string is what shows up in Scalar UI; keep it identical to the Next route segment so users can copy-paste.

## `api-helpers.ts` — shared HTTP plumbing

Four exports, each does one thing.

### `errorResponse(code, status, details?)`

Returns a `Response` with `cache-control: no-store`. Body shape:

```json
{ "error": "<code>", "details": <unknown> }
```

`code` is constrained to `ApiErrorCode` (`invalid_params` | `not_found` | `internal_error`) which is the same enum the Zod `ErrorResponseSchema` declares. Adding a new code requires updating both ends.

Logs are emitted by the **route handler**, not here. This helper is intentionally side-effect-free.

### `okJson(payload, cacheControl)`

Returns 200 with `content-type: application/json; charset=utf-8` and the caller-provided `cache-control`. Every successful response goes through this — do not hand-build a `new Response(JSON.stringify(...))` in a route handler. If a value cannot be serialized (e.g. raw `bigint`), you get a `TypeError: Do not know how to serialize a BigInt` here, which is desirable — fix the service.

### `parseSearchParams(schema, request)`

Pulls `URLSearchParams` into a flat `Record<string, string>`, runs `schema.safeParse(...)`, and returns either `{ ok: true, data }` or `{ ok: false, response }` where `response` is a 400 with `flattenZodError(...)` details (path → array of messages).

Coercion (`z.coerce.number()`, `z.coerce.boolean()`, etc.) is done by Zod — we hand it strings, it does the rest. Array query params are **not** supported by this helper (URLSearchParams allows them but no current schema needs them); if you need that, extend here.

### `parseRouteParams(schema, raw)`

Same shape but accepts the already-resolved `await ctx.params` object directly (no URL parsing). Use this for dynamic route segments in App Router handlers.

### Why the `ParseResult` discriminated union

Both parsers return `{ ok: true, data } | { ok: false, response }`. Route handlers do:

```ts
const parsed = parseSearchParams(Schema, request);
if (!parsed.ok) return parsed.response;
// use parsed.data
```

This keeps the failure path one-line and the success path narrowed without exceptions. Do **not** throw from these helpers — exceptions in route handlers turn into 500s with no body.

## Pitfalls

- Importing `z` from `'zod'` (covered above) — schema work breaks subtly.
- Calling `generateOpenApiDocument()` at module init — it runs on every cold start. Keep it inside the route handler with a process-local cache.
- Writing `cache-control` directly into `new Response` — route handlers should always go through `okJson` / `errorResponse` so the cache matrix stays auditable in one diff.
