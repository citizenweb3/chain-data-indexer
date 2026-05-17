# src/app/api/

Public read-only HTTP API. Next.js 16 App Router route handlers. All endpoints are versioned under `/api/v1/*` except the OpenAPI document at `/api/openapi.json`.

## Routes

| Route | Handler | Service backing | Cache-Control |
|-------|---------|-----------------|---------------|
| `GET /api/v1/health` | `v1/health/route.ts` | `getSyncWatermark` (MAX `event_height` / `event_time` from `ibc_packets`) | `no-store` |
| `GET /api/v1/stats` | `v1/stats/route.ts` | `getStats` | `public, max-age=30` |
| `GET /api/v1/channels` | `v1/channels/route.ts` | `listChannels` | `public, max-age=30` |
| `GET /api/v1/assets` | `v1/assets/route.ts` | `getAssetsBreakdown` | `public, max-age=30` |
| `GET /api/v1/timeseries` | `v1/timeseries/route.ts` | `getTimeseries` (daily) / `getTimeseriesHourly` (when `bucket=hour`) | `public, max-age=60` |
| `GET /api/v1/transfers` | `v1/transfers/route.ts` | `listTransfers` | `public, max-age=10` |
| `GET /api/v1/transfers/[port]/[channel]/[sequence]` | `v1/transfers/[port]/[channel]/[sequence]/route.ts` | `getTransfer` | `public, max-age=60` in-flight, `public, max-age=86400` for `acknowledged` / `timeout` / `failed` |
| `GET /api/openapi.json` | `openapi.json/route.ts` | `generateOpenApiDocument` | `public, max-age=300` |

The OpenAPI document is consumed by Scalar UI mounted at `/docs` (RSC page in `src/app/docs/`).

## Auth model

None. This is an MVP read-only API. If you add auth later, do it at the edge (middleware) rather than per-handler — adding `Authorization` checks inside every `route.ts` will rot quickly.

## `export const dynamic = 'force-dynamic'` on every handler

Every `/api/v1/*` route handler declares:

```ts
export const dynamic = 'force-dynamic';
```

Reason: Next 16 will otherwise attempt to **statically render** route handlers that have no headers / cookies / search-param reads it can detect, baking the response into the build. Our cache strategy is HTTP-layer (`cache-control` headers + CDN), not build-time. `force-dynamic` opts out of static optimization unambiguously regardless of what the handler body looks like to the analyzer.

`/api/openapi.json` is the exception — it uses `export const dynamic = 'force-static'` because the OpenAPI document is build-time deterministic (a function of the schema files) and an in-memory string cache covers cold starts.

If you remove `force-dynamic` from a `/api/v1/*` handler, expect intermittently stale data on subsequent deploys.

## Cache-Control matrix — rationale

| TTL | Endpoints | Why |
|-----|-----------|-----|
| `no-store` | `/health`, all 4xx/5xx | Health is a liveness probe; cached errors mislead clients |
| 10s | `/transfers` (list) | New packets land every ~6s upstream; 10s is the right freshness/load tradeoff |
| 30s | `/stats`, `/channels` | Aggregated dashboard data — sub-minute is plenty |
| 60s | `/timeseries`, `/transfers/[...]` (in-flight) | Daily buckets only redraw on UTC rollover; per-packet detail rarely changes once routed |
| 86400s | `/transfers/[...]` (finalized) | `acknowledged` / `timeout` / `failed` are terminal states. A day of staleness is fine because the data is immutable |
| 300s | `/openapi.json` | Document changes only with a deploy |

All values are baked into the route handler via `okJson(payload, '<cache-control>')`. Do not split the cache header between code and a CDN config — keep it auditable in one place.

The terminal-state branch in the transfer detail handler:

```ts
const FINALIZED = new Set(['acknowledged', 'timeout', 'failed']);
const cache = FINALIZED.has(dto.status)
  ? 'public, max-age=86400'
  : 'public, max-age=60';
```

If a new packet status is introduced, decide explicitly whether it is terminal and update this Set.

## Validation flow

Every handler follows the same shape:

```ts
export const dynamic = 'force-dynamic';
const log = logger('api/<name>');

export const GET = async (request: Request): Promise<Response> => {
  const parsed = parseSearchParams(<Name>QuerySchema, request);
  if (!parsed.ok) return parsed.response;   // 400 with details

  try {
    const result = await <service>(parsed.data);
    return okJson(result, '<cache-control>');
  } catch (e) {
    log.logError('<name> failed', { error: (e as Error).message });
    return errorResponse('internal_error', 500);
  }
};
```

Steps in order:
1. Zod parse the input via `parseSearchParams` (query) or `parseRouteParams` (dynamic segments). On failure return the 400 the helper built (already cache `no-store`, already includes `details` map).
2. Call the service. Pass through typed fields — the handler's job is **mapping**, not business logic. Snake_case query keys → camelCase service params.
3. Wrap the success in `okJson(result, cache)`. Only stats / channels / timeseries wrap data in `{ data }` themselves — for those endpoints the wrapping is done by the handler (`okJson({ data }, '...')`); for transfers list the service already returns the full envelope (`{ data, cursor, has_more, total }`).
4. Catch any throw, log via `logger('<scope>').logError(...)`, return 500 via `errorResponse`. **Never** leak the raw error message to the response body.

## 404 — only one place

`/api/v1/transfers/[port]/[channel]/[sequence]` returns 404 when `getTransfer(...)` returns `null`:

```ts
if (!dto) return errorResponse('not_found', 404);
```

Other endpoints never 404. List endpoints return `{ data: [] }` with `total: 0` for empty results — that is correct REST, not an error.

## Pagination contracts

- `/api/v1/transfers` — **keyset** via `before_height`, `before_sequence`, `before_channel`, `before_port`. Response includes `cursor`, `has_more`, `total`. See `src/services/AGENTS.md` for the why-4-tuple discussion.
- `/api/v1/channels` — **offset/limit**. The total channel set is small (tens, not millions), so offset is fine. Response includes `{ page: { total, limit, offset } }`.

If you add a new list endpoint, default to keyset. Offset is acceptable only when the underlying set is bounded and the order is stable.

## Logging

Each handler instantiates `logger('api/<scope>')` once at module top:

```ts
const log = logger('api/stats');
```

Use `log.logError(message, fields)` for the 500 catch. Do not log on success — the access log lives upstream (proxy / platform). Do not log Zod 400s — they are user errors and would flood the log on a misconfigured client.

## Adding a new endpoint — checklist

1. Add schemas to `src/schemas/<name>.ts` (query, response, types).
2. Add the service to `src/services/<name>-service.ts`.
3. Create `src/app/api/v1/<name>/route.ts` following the validation flow above.
4. Pick a cache TTL from the matrix; document the choice if it is novel.
5. Register the response schema + path in `src/lib/openapi.ts`.
6. Verify `/api/openapi.json` includes the new path and `/docs` renders it.
7. Hit the endpoint locally — confirm both the 200 and a 400 (force a bad query param).
