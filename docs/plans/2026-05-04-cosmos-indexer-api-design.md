# Cosmos Indexer API — Design Document

**Date:** 2026-05-04
**Branch:** `cosmos-indexer-api` (orphan branch in `chain-data-indexer` repo)
**Status:** Approved, ready for implementation

---

## 1. Purpose and Scope

A separate Next.js service that exposes a JSON HTTP API on top of the PostgreSQL database produced by the Cosmos indexer (`chain-data-indexer`, latest in branch `cosmos-bugfix-1`). The API powers the ValidatorInfo block explorer (Cosmos chains) and is built as a standalone service — not as additional handlers in the indexer — because:

- **Different lifecycle.** Indexer is backend infrastructure; API will get a dashboard, authentication, billing, and key issuance.
- **Different stack.** Indexer is plain Node + workers; API is Next.js 16 (App Router, Server Components for the future dashboard).
- **Different security surface.** Read-only role on Postgres; the API never writes to indexer schemas.
- **Independent deploy.** Separate Docker image, separate compose, can scale horizontally.

### MVP scope (5 endpoints)

1. `GET /api/v1/blocks` — paginated list, latest first.
2. `GET /api/v1/blocks/height/:h` — single block by height.
3. `GET /api/v1/txs` — paginated list, latest first.
4. `GET /api/v1/txs/:hash` — transaction detail (with messages and events).
5. `GET /api/v1/txs/:hash/raw` — raw transaction JSON (separate endpoint to keep detail payload small).

Plus operational endpoints: `/api/v1/health`, `/api/openapi.json`, `/docs` (Swagger/Scalar UI).

### Out of scope (MVP)

- Block lookup by hash. Confirmed dropped — explorer routes go via height.
- Multi-chain routing in one API instance. One API process serves one Postgres.
- Dashboard pages, user accounts, payments, key issuance.
- Rate limiting (only one trusted client at MVP).
- Autoscaling / horizontal infrastructure.

---

## 2. Stack

| Concern              | Choice                                                                 |
|----------------------|------------------------------------------------------------------------|
| Framework            | **Next.js 16** (App Router, Route Handlers)                            |
| Language             | TypeScript 5.1+ strict, ESM, Node 22                                   |
| Postgres client      | `postgres` (postgres.js) — ESM-first, template literals, pool built-in |
| Validation           | `zod` for query/path params and env config                             |
| OpenAPI              | `@asteasolutions/zod-to-openapi` — spec generated from Zod             |
| API docs UI          | Scalar API Reference (`@scalar/api-reference-react`)                   |
| Logger               | `pino` (JSON output, suitable for Docker logs)                         |
| Lint/format          | ESLint + Prettier (style identical to indexer: 120 cols, single quotes, semicolons, trailing commas) |
| Container            | Multi-stage Dockerfile, `node:22-alpine`, `output: 'standalone'`       |
| Runtime              | Node.js (default) — required because postgres.js uses TCP              |

### Deferred

- ORM / migrations for the API's own DB (drizzle-orm or prisma) — added when billing/users tables appear.
- NextAuth or custom session — added with the dashboard.
- Stripe / crypto payment libs — added with billing.
- Rate limiter (Redis or in-memory LRU) — added when API opens to multiple clients.

---

## 3. Database Access

### Connection

API connects from its container to the indexer's PostgreSQL using the `host.docker.internal:host-gateway` Docker pattern (the same pattern already used by `validatorinfo/agents-infrastructure`):

```yaml
services:
  api:
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      DATABASE_URL: postgres://api_reader:${PG_API_READER_PASSWORD}@host.docker.internal:${PG_PORT:-5432}/${PG_DB}
```

The indexer compose already exposes Postgres on the host port (`"${PG_PORT:-5432}:5432"`), so no changes to the indexer's networking are required.

### Read-only role (required from indexer team)

A new role `api_reader` with `SELECT` privileges on all indexer schemas (`core`, `bank`, `stake`, `gov`, `ibc`, `wasm`, `authz_feegrant`, `groups`, `tokens`, `analytics`). Created via `initdb/050-api-reader.sh` and `050-api-reader.sql` in the indexer repo. Idempotent for re-runs on existing DBs. Full task description in section 8.

### Pool

postgres.js singleton with `max=10`, `idle_timeout=20`, `connect_timeout=10`. BigInt mapped to native bigint. Prepared statements enabled.

---

## 4. Endpoints

### 4.1 `GET /api/v1/blocks`

**Query (Zod-validated):**

| Param           | Type          | Default | Notes                                  |
|-----------------|---------------|---------|----------------------------------------|
| `limit`         | int 1..100    | 50      |                                        |
| `before_height` | int, optional |         | keyset cursor for "next page"          |
| `after_height`  | int, optional |         | keyset cursor for "previous page"      |

`before_height` and `after_height` are mutually exclusive.

**Response:**

```json
{
  "data": [
    {
      "block_hash": "...",
      "height": 21600100,
      "time": "2026-05-04T12:00:00Z",
      "tx_count": 8,
      "proposer_address": "..."
    }
  ],
  "cursor": { "next_before_height": 21600001 },
  "total": 21600101
}
```

**SQL:**

```sql
SELECT block_hash, height, time, tx_count, proposer_address
FROM core.blocks
WHERE ($1::bigint IS NULL OR height < $1)
ORDER BY height DESC
LIMIT $2;

SELECT COALESCE(MAX(height), -1) + 1 AS total FROM core.blocks;
```

The list query is an index scan on the primary key `height` with partition pruning. The total query is a single PK lookup (`MAX(height)`). Both run in milliseconds at any chain depth.

**Cache:** `revalidate = 6` (matches typical Cosmos block time).

### 4.2 `GET /api/v1/blocks/height/:h`

**Path param:** `h` — `^\d+$`.

**Response:**

```json
{
  "data": {
    "block_hash": "...", "height": 21600100, "time": "...",
    "proposer_address": "...", "tx_count": 8,
    "size_bytes": 12345, "last_commit_hash": "...",
    "data_hash": "...", "app_hash": "...", "evidence_count": 0
  }
}
```

`404` if not found.

**SQL:** `SELECT * FROM core.blocks WHERE height = $1` — PK lookup.

**Cache:** `dynamic = 'force-static'`, `revalidate = false`. Block is immutable.

### 4.3 `GET /api/v1/txs`

**Query:**

| Param           | Type          | Default |
|-----------------|---------------|---------|
| `limit`         | int 1..100    | 50      |
| `before_height` | int, optional |         |
| `before_index`  | int, optional |         |
| `after_height`  | int, optional |         |
| `after_index`   | int, optional |         |

`before_*` are paired (both required if either is given), same for `after_*`.

**Response:**

```json
{
  "data": [
    {
      "tx_hash": "...", "height": 21600100, "tx_index": 2,
      "time": "...", "code": 0,
      "first_msg_type": "/cosmos.bank.v1beta1.MsgSend",
      "fee": { "amount": "3170", "denom": "uatom" }
    }
  ],
  "cursor": { "next_before_height": 21600100, "next_before_index": 0 },
  "total": 80935217
}
```

**SQL:**

```sql
SELECT
  t.tx_hash, t.height, t.tx_index, t.time, t.code,
  t.fee->'amount'->0->>'amount' AS fee_amount,
  t.fee->'amount'->0->>'denom'  AS fee_denom,
  m.type_url AS first_msg_type
FROM core.transactions t
LEFT JOIN core.messages m
  ON m.height = t.height AND m.tx_hash = t.tx_hash AND m.msg_index = 0
WHERE ($1::bigint IS NULL OR (t.height, t.tx_index) < ($1, $2))
ORDER BY t.height DESC, t.tx_index DESC
LIMIT $3;

SELECT reltuples::bigint AS total
FROM pg_class WHERE oid = 'core.transactions'::regclass;
```

The JOIN uses the messages PK `(height, tx_hash, msg_index)` with partition pruning. 100 lookups remain fast. `pg_class.reltuples` returns an approximate count from planner statistics — instant, refreshed by autovacuum, accuracy ±1-5% which is acceptable for the explorer ("~80M transactions").

**Cache:** `revalidate = 6`.

### 4.4 `GET /api/v1/txs/:hash`

**Path param:** `hash` — `^[A-F0-9]{64}$/i`.

**Response:**

```json
{
  "data": {
    "tx_hash": "...", "height": 21600100, "tx_index": 2,
    "time": "...", "code": 0,
    "gas_wanted": 200000, "gas_used": 142331,
    "fee": { "amount": [{"amount": "3170", "denom": "uatom"}], "gas_limit": "200000", "payer": "", "granter": "" },
    "memo": "...", "signers": ["cosmos1..."],
    "log_summary": "...",
    "messages": [
      { "msg_index": 0, "type_url": "/cosmos.bank.v1beta1.MsgSend", "value": {}, "signer": "cosmos1..." }
    ],
    "events": [
      { "msg_index": 0, "event_index": 0, "event_type": "transfer", "attributes": [{"key":"sender","value":"..."}] }
    ]
  }
}
```

`raw_tx` intentionally **not** included — fetched separately via `/raw`.

**SQL (sequenced):**

1. Fetch tx by hash (uses `idx_txs_hash`).
2. With the resulting `height`, fetch messages and events in parallel via `Promise.all` (partition pruning by height).

```sql
SELECT tx_hash, height, tx_index, time, code, gas_wanted, gas_used,
       fee, memo, signers, log_summary
FROM core.transactions
WHERE tx_hash = $1
LIMIT 1;

SELECT msg_index, type_url, value, signer
FROM core.messages
WHERE tx_hash = $1 AND height = $2
ORDER BY msg_index;

SELECT msg_index, event_index, event_type, attributes
FROM core.events
WHERE tx_hash = $1 AND height = $2
ORDER BY msg_index, event_index;
```

**Cache:** `dynamic = 'force-static'`, `revalidate = false`. Tx is immutable once indexed.

### 4.5 `GET /api/v1/txs/:hash/raw`

Separate endpoint so the heavyweight `raw_tx` JSONB (potentially tens of KB) is fetched only when the explorer renders the JSON view (`/tx/[hash]/json/` route in ValidatorInfo).

**Response:** `{ "data": { "raw_tx": { ... } } }`

**SQL:** `SELECT raw_tx FROM core.transactions WHERE tx_hash = $1 LIMIT 1`

**Cache:** `force-static`, immutable.

### 4.6 Operational endpoints

- `GET /api/v1/health` — `SELECT 1`. No auth. `200 {status:"ok"}` or `503 {status:"degraded"}`. Used by Docker healthcheck.
- `GET /api/openapi.json` — full OpenAPI 3.1 spec generated from Zod schemas. No auth (the spec is public documentation).
- `GET /docs` — Scalar API Reference UI mounted as a Server Component reading the local `/api/openapi.json`.

### 4.7 Common response rules

- Errors are JSON: `400 {error:"invalid_params", details:[...]}`, `401 {error:"unauthorized"}`, `404 {error:"not_found"}`, `500 {error:"internal_error"}`. DB error details never leak — they are logged with full context.
- All responses are `Content-Type: application/json; charset=utf-8`.
- Cache-Control headers are set per endpoint via Next.js segment config; immutable detail endpoints additionally set `Cache-Control: public, max-age=31536000, immutable` for downstream proxies.

### 4.8 Pagination — why keyset, not offset

Cosmos LCD pagination supports both offset and `key` (keyset). LCD docs explicitly recommend keyset for large datasets because Postgres scans and discards `OFFSET` rows. On a 24M-block chain, paging to offset 2.4M means scanning 2.4M index entries before returning 100. Keyset (`WHERE height < $last`) is `O(log n)` regardless of depth, matches the explorer UX (next/prev/latest), and uses the existing PK and partitioning. Total counts are computed cheaply: blocks via `MAX(height)`, transactions via `pg_class.reltuples`.

---

## 5. Authentication

Server-to-server, single static API key.

- The same `API_KEY` value lives in the API's `.env` and in ValidatorInfo's `.env` (as `COSMOS_INDEXER_API_KEY`).
- ValidatorInfo's backend (Server Components and its own API routes) sends the key in `X-Api-Key` on every request to the API.
- The API checks the key in each handler via a shared helper using `crypto.timingSafeEqual` to avoid timing-side-channel concerns.
- The key never reaches the browser — only ValidatorInfo's server side knows it.
- A wrong/missing key returns `401 {error:"unauthorized"}`.

```ts
// src/lib/auth/api-key.ts
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
```

Each handler calls `assertApiKey(req)` as the first line; if it returns a Response, return it immediately. No `proxy.ts` (formerly `middleware.ts`) is used — Next.js 16 deprecated `middleware.ts` in favor of `proxy.ts`, but inline checks are simpler and explicit for a small number of handlers.

When per-user keys are introduced for billing, `api-key.ts` will be expanded to look up the key in the API's own database with hashed storage and per-tariff rate limits; handler call sites stay the same.

---

## 6. Project layout

Aligned with the convention used in ValidatorInfo (`src/services/`, `src/db.ts`, top-level utility files).

```
chain-data-indexer/                              (same git repo, branch cosmos-indexer-api, orphan)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── v1/
│   │   │   │   ├── blocks/
│   │   │   │   │   ├── route.ts
│   │   │   │   │   └── height/[h]/route.ts
│   │   │   │   ├── txs/
│   │   │   │   │   ├── route.ts
│   │   │   │   │   └── [hash]/
│   │   │   │   │       ├── route.ts
│   │   │   │   │       └── raw/route.ts
│   │   │   │   └── health/route.ts
│   │   │   └── openapi.json/route.ts
│   │   ├── (auth)/                              # placeholder, future login UI
│   │   ├── (dashboard)/                         # placeholder, future user dashboard
│   │   ├── docs/page.tsx                        # Scalar UI
│   │   ├── page.tsx                             # public landing
│   │   └── layout.tsx
│   ├── services/
│   │   ├── blocks-service.ts
│   │   └── txs-service.ts
│   ├── queries/
│   │   ├── blocks-queries.ts
│   │   └── txs-queries.ts
│   ├── schemas/                                 # Zod + OpenAPI metadata
│   │   ├── blocks.ts
│   │   ├── txs.ts
│   │   ├── pagination.ts
│   │   └── common.ts
│   ├── db/
│   │   ├── indexer-db.ts                        # postgres.js singleton (read-only)
│   │   └── app-db.ts                            # placeholder for the service's own DB
│   ├── lib/
│   │   ├── auth/
│   │   │   ├── api-key.ts
│   │   │   └── session.ts                       # placeholder
│   │   └── openapi.ts
│   ├── components/                              # placeholder
│   ├── env.ts
│   ├── errors.ts
│   └── logger.ts
├── public/
├── messages/                                    # i18n placeholder
├── .dockerignore
├── .env.example
├── .gitignore
├── .prettierrc.json
├── docker-compose.yaml
├── Dockerfile
├── eslint.config.mjs
├── next.config.ts
├── package.json
├── tsconfig.json
├── README.md
└── AGENTS.md
```

### Layer responsibilities

- **Route handlers** (`src/app/api/...`): HTTP-only — auth check, parse and validate via Zod, call a service, return the response. Roughly 20–30 lines each.
- **Services** (`src/services/`): business logic — compose multiple queries with `Promise.all`, compute cursor, parse `fee` JSONB, build the final DTO. No HTTP knowledge; reusable from future Server Components without an HTTP hop.
- **Queries** (`src/queries/`): pure SQL with typed parameters; return raw rows in snake_case as in the schema.

### Why `src/services/` and not `src/lib/services/`

Aligning with ValidatorInfo's existing convention — its services live at `src/services/*-service.ts` (`blocks-service.ts`, `tx-service.ts`, `chain-service.ts`, etc.). The future shared imports (`@/services/cosmos-indexer-api`) will mirror the same shape used for `aztec-indexer-api` and `logos-indexer-api`.

---

## 7. Docker and deploy

### Dockerfile (multi-stage)

Three stages: deps install → Next build → minimal runtime image. Final image uses the `output: 'standalone'` Next.js artefact (~150 MB) running as a non-root user.

### docker-compose.yaml

```yaml
services:
  api:
    build: { context: ., dockerfile: Dockerfile }
    container_name: cosmos-indexer-api
    restart: unless-stopped
    extra_hosts:
      - "host.docker.internal:host-gateway"
    environment:
      DATABASE_URL: postgres://api_reader:${PG_API_READER_PASSWORD}@host.docker.internal:${PG_PORT:-5432}/${PG_DB}
      API_KEY: ${API_KEY}
      LOG_LEVEL: ${LOG_LEVEL:-info}
      PG_POOL_MAX: ${PG_POOL_MAX:-10}
      NODE_ENV: production
    ports:
      - "${API_PORT:-3001}:3000"
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://127.0.0.1:3000/api/v1/health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s
```

### .env.example

```
PG_API_READER_PASSWORD=set_me
PG_PORT=5432
PG_DB=cdi
API_KEY=generate_32_char_hex
PG_POOL_MAX=10
LOG_LEVEL=info
API_PORT=3001
```

### Workflow

Dev: `yarn install`, `cp .env.example .env`, `yarn dev`.
Prod: deploy on the same host as the indexer; `docker compose --env-file .env up --build -d`. Logs via `docker compose logs -f api`. API listens on `${API_PORT:-3001}` on the host.

### Reverse proxy

Out of scope for MVP. The API is internal — only ValidatorInfo's backend calls it. When opening publicly, front it with nginx or caddy with TLS.

---

## 8. Indexer team task (parallel work item)

**Goal:** create a read-only Postgres role for the API.

### Action items

1. Add `initdb/050-api-reader.sql` (idempotent, uses psql variables for the password and DB name).
2. Add `initdb/050-api-reader.sh` wrapper that invokes psql with `POSTGRES_USER`, `POSTGRES_DB`, and `PG_API_READER_PASSWORD`.
3. Add `PG_API_READER_PASSWORD` to the indexer's `docker-compose.yaml` env block for the `db` service.
4. Add `PG_API_READER_PASSWORD` to `.env.example`.
5. Apply the script to the running prod database manually (initdb only runs on a fresh volume):

```bash
docker compose exec -T db psql -U "$PG_USER" -d "$PG_DB" \
  -v "api_reader_password=$PG_API_READER_PASSWORD" \
  -v "db_name=$PG_DB" \
  -f /docker-entrypoint-initdb.d/050-api-reader.sql
```

6. Hand the API team: hostname/exposed port, DB name, the `api_reader` password.

### Required SQL

```sql
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'api_reader') THEN
    EXECUTE format('CREATE ROLE api_reader LOGIN PASSWORD %L', :'api_reader_password');
  END IF;
END
$$;

GRANT CONNECT ON DATABASE :"db_name" TO api_reader;

DO $$
DECLARE
  s TEXT;
  schemas TEXT[] := ARRAY[
    'core', 'bank', 'stake', 'gov', 'ibc', 'wasm',
    'authz_feegrant', 'groups', 'tokens', 'analytics'
  ];
BEGIN
  FOREACH s IN ARRAY schemas LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO api_reader', s);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO api_reader', s);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT SELECT ON TABLES TO api_reader',
      s
    );
  END LOOP;
END
$$;
```

### Out of scope for the indexer team

- No schema changes.
- No new indexes (`block_hash` lookup was dropped from the API).
- No named docker network (API uses `host.docker.internal`).
- No changes to existing user permissions.

---

## 9. Implementation plan

Five PRs against the `cosmos-indexer-api` branch, plus one PR in the ValidatorInfo repo.

### Stage 0 — Indexer team request (parallel)

Send the section 8 task to the indexer team. Stages 1–4 do not block on its completion — dev work can use a temporary connection under the indexer's own user.

### Stage 1 — Scaffold (1 PR)

Empty Next.js 16 project that builds and runs in Docker. Includes:

- `package.json` (Next 16, React 19, TS 5+, postgres.js, zod, pino, eslint, prettier).
- `tsconfig.json` with `paths: {"@/*": ["src/*"]}`.
- `next.config.ts` with `output: 'standalone'`.
- `eslint.config.mjs`, `.prettierrc.json` matching indexer style.
- `Dockerfile`, `docker-compose.yaml`, `.dockerignore`, `.env.example`.
- `src/env.ts`, `src/logger.ts`, `src/errors.ts`.
- `src/app/layout.tsx` (minimal root).
- `src/app/api/v1/health/route.ts` (no auth, `SELECT 1`).
- `src/db/indexer-db.ts` (postgres.js singleton).
- `README.md`, `AGENTS.md`.

**Acceptance:** `yarn dev` runs locally; `curl /api/v1/health` returns OK; Docker image builds.

### Stage 2 — Auth + validation schemas (1 PR)

- `src/lib/auth/api-key.ts` — `assertApiKey` with `timingSafeEqual`.
- `src/schemas/pagination.ts`, `src/schemas/blocks.ts`, `src/schemas/txs.ts`, `src/schemas/common.ts`.
- A throwaway protected endpoint to verify `401`/`200` paths.

### Stage 3 — Blocks (1 PR)

- `src/queries/blocks-queries.ts`, `src/services/blocks-service.ts`.
- `src/app/api/v1/blocks/route.ts`, `src/app/api/v1/blocks/height/[h]/route.ts`.

**Acceptance:** list returns 100 latest blocks with cursor and total; cursor pagination works; `/height/:h` returns one block or `404`; both endpoints require `X-Api-Key`.

### Stage 4 — Transactions (1 PR)

- `src/queries/txs-queries.ts`, `src/services/txs-service.ts`.
- `src/app/api/v1/txs/route.ts`, `src/app/api/v1/txs/[hash]/route.ts`, `src/app/api/v1/txs/[hash]/raw/route.ts`.

**Acceptance:** list returns latest txs with `first_msg_type` (via JOIN); detail returns full tx + messages + events; `/raw` returns just `raw_tx`.

### Stage 5 — OpenAPI + Scalar UI (1 PR)

- `src/lib/openapi.ts` with `extendZodWithOpenApi`, schema registry, `generateOpenApiDocument()`.
- All Zod schemas annotated with `.openapi({...})`.
- `src/app/api/openapi.json/route.ts`.
- `src/app/docs/page.tsx` rendering Scalar API Reference.

**Acceptance:** `/api/openapi.json` is a valid OpenAPI 3.1 document; `/docs` shows interactive documentation for the five endpoints.

### Stage 6 — ValidatorInfo integration (separate PR in ValidatorInfo)

- `src/services/cosmos-indexer-api/index.ts` — client following the `aztec-indexer-api` / `logos-indexer-api` pattern.
- `src/services/cosmos-indexer-api/types.ts`.
- Wire into `tx-service.ts` and `blocks-service.ts` for Cosmos chains.
- `.env.example` adds `COSMOS_INDEXER_API_URL`, `COSMOS_INDEXER_API_KEY`.

This stage runs after the API is deployed; it lives in the ValidatorInfo repo, not here.

---

## 10. Future-proofing

The MVP layout already accommodates the planned monetised dashboard:

- `app/api/v1/...` — versioned URL allows future v2 without breaking ValidatorInfo.
- `app/(auth)/` and `app/(dashboard)/` — Next.js route groups for separate layouts (login form vs. authenticated dashboard).
- `src/db/app-db.ts` — placeholder for the API's own writable database (users, api_keys, subscriptions, usage). Activated when billing tables appear.
- `src/lib/auth/api-key.ts` will be extended to consult `app-db` instead of a single env value.
- `src/lib/auth/session.ts` — placeholder for dashboard session auth (NextAuth or custom).
- `src/lib/openapi.ts` — already in MVP; spec evolves alongside endpoints.
- `messages/` — i18n placeholder following ValidatorInfo's pattern.

When billing arrives, the additions are: drizzle-orm + migrations in `drizzle/`, billing service + Stripe/crypto integration in `src/lib/`, dashboard pages in `(dashboard)/`. None of these require a refactor of the existing layout.

---

## 11. Open questions deferred until later

- ORM choice for the API's own DB (drizzle vs. prisma). To be resolved when billing schema is designed.
- Payment provider (Stripe, crypto, both). Resolved when billing is scoped.
- Rate-limit substrate (Redis vs. in-memory LRU). Resolved when the API opens to multiple clients.
- Per-tariff rate limit shape (req/min, daily quota, burst). Resolved with billing.
- Observability stack (Prometheus, OpenTelemetry, log shipper). Resolved closer to public launch.

These are deliberately out of MVP scope and recorded here so they are not forgotten.
