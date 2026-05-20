# atomone-indexer-api

Read-only JSON API over the AtomOne chain-data-indexer Postgres database. Next.js 16 App Router, deployed as a standalone Docker container in `/pool0/atomone-indexer-api` and attached to `atomone-indexer-net`.

> **Branch:** `atomone-indexer-api` is a dedicated API branch derived from `cosmos-indexer-api`. The AtomOne indexer itself lives in branch `atomone-indexer`. Keep deployments in separate directories/worktrees.

## Stack

| Layer | Tech |
|---|---|
| Runtime | Node 22 (alpine), Next.js 16 standalone output |
| Routing | App Router Route Handlers, `dynamic = 'force-dynamic'` |
| DB driver | `postgres` v3 (`types.bigint = postgres.BigInt` — native BigInt) |
| Validation | `zod` v3 + `@asteasolutions/zod-to-openapi` |
| Docs UI | `@scalar/api-reference-react` at `/docs` |
| Logger | `pino` with `redact` paths + `stdSerializers.err` |
| Auth | `x-api-key` header, `crypto.timingSafeEqual` |

## Directories

| Path | Role | Doc |
|---|---|---|
| `src/app/api/v1/` | Route handlers (HTTP edge) | `AGENTS.md` |
| `src/services/` | Service layer; converts BigInt → string for JSON | `AGENTS.md` |
| `src/queries/` | SQL via tagged templates; returns BigInt natively | `AGENTS.md` |
| `src/schemas/` | Zod request schemas (params/query) | `AGENTS.md` |
| `src/lib/` | Auth, OpenAPI registry | `AGENTS.md` |
| `src/db/indexer-db.ts` | `postgres()` connection (idle 60s, max-lifetime 1800s) |  |
| `src/env.ts` | Zod-validated env (skipped when `NEXT_PHASE=phase-production-build`) |  |
| `src/errors.ts` | `errorResponse(code, status, details)` helper |  |
| `src/logger.ts` | Pino instance with redact |  |
| `src/app/docs/page.tsx` | Scalar UI |  |
| `src/app/api/openapi.json/route.ts` | OpenAPI 3.1 spec |  |

## Environment

Required (`src/env.ts`):
- `DATABASE_URL` — postgres connection string
- `API_KEY` — single key for `x-api-key` header (multi-key not yet supported)

Optional:
- `LOG_LEVEL` (default `info`)
- `PORT` (default `3080`)
- `NODE_ENV` (default `production`)

See `.env.example`. Default targets docker-compose on `atomone-indexer-net` (`atomoneindexer:5432`); for `yarn dev` swap host to `localhost:2433`.

## Commands

| | |
|---|---|
| `yarn dev` | dev server with HMR |
| `yarn build` | Next.js standalone build |
| `yarn start` | start built server |
| `yarn typecheck` | `tsc --noEmit` |
| `yarn lint` | eslint over `src` |
| `docker compose up -d --build` | build + run prod container |
| `docker compose down` | stop |
| `gitnexus analyze .` | reindex graph |

## Deploy

`docker-compose.yaml`:
- Joins the external `atomone-indexer-net` network and reaches Postgres at `atomoneindexer:5432`.
- Binds the API only to `127.0.0.1:${PORT}` on the host.
- Uses `read_only`, `tmpfs`, `cap_drop: [ALL]`, and `no-new-privileges:true` as defence-in-depth.

## API contract notes

- Pagination: keyset, `limit+1` probe → `has_more` flag, cursor `{next_before_height[, next_before_index]}`.
- All `uint64` (height, gas, totals) serialized as **decimal string** — never JS `number`.
- `before_height` capped at 20 chars to block ZOD-DoS via `BigInt(longstring)`.
- Auth-gated routes use `Cache-Control: private, max-age=...` + `Vary: x-api-key`. Never `public` (CDN bypass risk).
- `force-dynamic` on every route reading `req.headers` (otherwise Next bails to static and bypasses auth).
- `txs/stats` cached in-memory with TTL 60s + inflight dedup.

## Database expectations

DB is owned by the indexer (separate repo). Tables we read:
- `core.blocks` — partitioned `RANGE(height)`. PK `(height)`.
- `core.transactions` — partitioned `RANGE(height)`. PK `(height, tx_hash)`. Has `tx_index`, `code`, `gas_*`, `fee` (jsonb), `signers`, `raw_tx` (jsonb).
- `core.messages` — partitioned `RANGE(height)`. PK `(height, tx_hash, msg_index)`.
- `core.events` — partitioned `RANGE(height)`. PK `(height, tx_hash, msg_index, event_index)`. **No `tx_hash` index** — always include `height` when filtering by tx.

For row counts on partitioned tables, `pg_class.reltuples` on the parent is always 0 — sum across child partitions via `pg_inherits` (see `queryTxsTotal`).

## See also

- `src/app/api/v1/AGENTS.md` — endpoint catalog
- `docs/010-readonly-api-role.sql` — AtomOne read-only role bootstrap
- `docs/plans/2026-05-04-cosmos-indexer-api-design.md` — historical source design
