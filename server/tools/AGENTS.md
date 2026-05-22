# server/tools/

Stateless helpers shared by `server/jobs/`. Each tool is a thin, single-purpose module — no business logic.

## Files

| File | Purpose |
|------|---------|
| `upstream-client.ts` | HTTP client for the upstream `indexer-ibc-api` (header auth + retry policy) |
| `upstream-types.ts` | Wire DTOs of the upstream service — **single source of truth** for the cross-service contract |
| `assets.ts` | Tiny accessor over the seeded `assets` table |

## `upstream-client.ts`

Single export: `fetchUpstream<T>(chain, path, params?) → Promise<T>`. Wraps `fetch` with:

- Base URL resolved per-chain via `getChainParams(chain).upstreamBaseUrl` — a literal string in `server/tools/chains/params.ts` — no env lookup.
- Auth header `x-api-key: <value>` resolved per-chain from the env name declared in `ChainParams.apiKeyEnv` (e.g. `COSMOSHUB_INDEXER_API_KEY`, `ATOMONE_INDEXER_API_KEY`). Validated on first use, never logged.
- Query params via `URL.searchParams.set` — `null` / `undefined` values are dropped.
- 5 retry attempts × 1500 ms backoff for transient errors.
- 60 second cooldown on HTTP 429 (does **not** consume a retry attempt — 429 is a back-pressure signal, not a failure).
- Every log line is prefixed `[${chain}]` so multi-chain runs are auditable.

Throws `UpstreamError` on non-OK responses after retries exhausted; throws the underlying network error if all 5 attempts threw.

### Why a custom client (not axios / undici)

- `fetch` is in Node 22 stdlib — no extra dep.
- The retry policy is small (~40 lines) and specific to this upstream's behavior. A general retry library would be more code than the policy itself.
- `UpstreamError` carries `status` and raw `body` for diagnostics — useful in worker logs.

### Why 429 has its own path

The upstream's rate limit headers are not advertised in the DTO. 60 s is a safe blanket cooldown that empirically clears every observed throttle bucket. Treating 429 as a normal retry would waste attempts on a known-to-fail call.

### Not for CoinGecko

CoinGecko has its own retry logic embedded in `server/jobs/get-price-history.ts` because:
- Different base URL.
- Different auth (free tier = no auth).
- Different 429 semantics (longer recovery).

Do not unify them.

## `upstream-types.ts`

Wire DTOs of the upstream `indexer-ibc-api` service. **This file is the single source of truth** for the cross-service contract.

### Shared with api-dev

The wire shape is used by **two** consumers:
1. `server/jobs/sync-ibc-transfers.ts` — parses upstream responses into the local `ibc_packets` mirror.
2. `src/services/transfers-service.ts` (api-dev's zone) — references the same DTOs as the canonical wire shape, even though the API service itself reads from local Postgres (not from upstream directly). Symmetry across services is intentional: when someone needs to extend a field, there is one file to grep.

Any change to a field name, nullability, or addition must be coordinated with api-dev. Treat this file like a public API contract.

### Wire-shape conventions

- Every numeric uint64 field is serialized as a **decimal string** by upstream (Postgres `BIGINT` → JS string to avoid `Number.MAX_SAFE_INTEGER` issues). Never `Number(...)` these — use `BigInt(...)` in worker code, or pass the string through to the DB where Prisma will coerce to BigInt for `bigint` columns.
- `amount` is a decimal string for `NUMERIC(80, 0)`. Validate format before storing — `parseAmount` in `sync-ibc-transfers.ts` checks `/^-?\d+$/`.
- `event_time` is ISO 8601 UTC string. Construct `new Date(event_time)` in the worker.
- All "did not happen" fields are `null`, not absent. The TS type uses `string | null`, not `string | undefined`. Optional in JSON, present in TS.

### Defensive supertype: `IbcTransferCursor.next_before_height`

The wire type is declared `string | null`. The current upstream never emits `null` for that field (the cursor as a whole is `null` instead). The supertype is defensive — if upstream ever extends to include pre-block packets in the cursor, the TS type already accepts that. `sync-ibc-transfers.ts:226` handles the null case by dropping the keyset param, which naturally ends pagination. Do not tighten this to `string` "for accuracy" — the breadth is intentional.

### `IbcTransferStatus` and `IbcTransferDirection`

String unions, not enums. Database columns store the same strings; no encode/decode layer needed. Adding a new status requires both:
1. Update the union here.
2. Update the API schema `src/schemas/*` (api-dev's zone) so client validation accepts it.

## `assets.ts`

Two functions, both thin Prisma wrappers:
- `getAssetByDenom(denom)` — `findUnique({ where: { nativeDenom: denom } })`. Used by recompute SQL planning (not at runtime — the SQL joins directly).
- `getAllAssets()` — `findMany({ orderBy: { id: 'asc' } })`. Used by `get-prices` and `get-price-history` to drive the asset-loop.

This file exists so jobs do not import Prisma directly for asset reads — keeps the surface minimal and lets us add caching later if needed (likely never; asset count is 1 in MVP, 10s long-term).
