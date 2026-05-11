# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Code Search & Documentation

### Finding Code (DeepContext)

When you need to find code, understand relationships between files, or locate implementations — use DeepContext MCP tools:

1. First run `index_codebase` if not indexed yet
2. Use `search_codebase` for semantic search queries

Examples:

- "rate limiting logic" → search_codebase
- "where is transaction decoded" → search_codebase
- "find all sink implementations" → search_codebase

Prefer DeepContext over grep for conceptual searches.

### Library Documentation (Context7)

When you need current API docs, usage examples, or library-specific patterns — use Context7 MCP tools:

1. `resolve-library-id` — find library ID by name
2. `query-docs` — fetch documentation

Use Context7 for:

- Correct syntax for library APIs (@cosmjs, protobufjs, pg, zod, undici)
- Up-to-date code examples
- Version-specific features

### When to Use What

| Need                      | Tool                     |
| ------------------------- | ------------------------ |
| Find code in this project | DeepContext              |
| Library docs / examples   | Context7                 |
| Exact string match        | grep                     |
| Project architecture      | Read this CLAUDE.md file |

---

## Project Overview

**Chain Data Indexer (CDI)** is a high-performance blockchain data indexer for the Cosmos ecosystem, built by Citizen Web3 for ValidatorInfo. It extracts, decodes, and stores blockchain data from Cosmos SDK chains into PostgreSQL.

**Data Flow Pipeline:**

```
RPC Client → Block Fetching → Tx Decoding Pool → Assembly → Normalize → Sink → Storage
              (Undici pool)    (Worker threads)   (BlockJson)  (Events)
```

---

## Commands

### Development (Local)

In development mode, **Postgres runs in Docker** while the **indexer runs locally** via tsx for fast iteration and debugging.

**Initial setup (once):**

```bash
yarn install --frozen-lockfile
npx tsx scripts/gen-known-msgs.ts    # generate proto artifacts (required)
cp .env.example .env                  # configure environment variables
```

**Daily workflow:**

```bash
make up         # start Postgres in Docker
yarn dev        # run indexer with hot-reload (watch mode)
```

**Other commands:**

```bash
yarn start      # run indexer without watch mode
yarn typecheck  # TypeScript type checking
yarn build      # build to dist/
```

**Database operations (Makefile):**

```bash
make up         # start Postgres
make down       # stop Postgres
make reset      # delete data and restart
make logs       # Postgres logs
make status     # container status
make psql       # connect to psql
make psql-file FILE=path/to/script.sql   # execute SQL file
```

---

### Production (Docker Compose)

In production, **both services (Postgres + Indexer) run in Docker** via docker-compose.

**Deploy:**

```bash
cp .env.example .env                              # configure environment
docker compose --env-file .env up --build -d      # start everything
```

**Monitoring:**

```bash
docker compose logs -f indexer    # indexer logs
docker compose logs -f db         # Postgres logs
docker compose logs -f            # all logs
docker compose ps                 # service status
```

**Management:**

```bash
docker compose --env-file .env down                # stop
docker compose --env-file .env up -d               # restart (no rebuild)
docker compose --env-file .env up --build -d       # rebuild and start
```

**Reset data (DANGEROUS):**

```bash
docker compose down -v && docker compose --env-file .env up --build -d
```

---

## Architecture

### Core Modules

| Module      | Location                    | Purpose                                                        |
| ----------- | --------------------------- | -------------------------------------------------------------- |
| Entry Point | `src/index.ts`              | Main orchestrator; initializes services, controls sync flow    |
| Config      | `src/config/`               | Environment-based config with Zod validation                   |
| RPC Client  | `src/rpc/client.ts`         | Undici HTTP client with token-bucket rate limiting, retries    |
| Tx Decoder  | `src/decode/txPool.ts`      | Worker thread pool for parallel protobuf decoding              |
| Assembly    | `src/assemble/blockJson.ts` | Combines RPC responses + decoded txs into `BlockJson`          |
| Normalize   | `src/normalize/`            | Event normalization (base64→UTF8) and governance data parsing  |
| Database    | `src/db/`                   | PostgreSQL pooling, partitioning, progress tracking, bulk mode |
| Sink        | `src/sink/`                 | Output backends: stdout, file, postgres, clickhouse, null      |
| Runner      | `src/runner/`               | `syncRange` (backfill) and `follow` (real-time polling) modes  |
| Health      | `src/health/`               | HTTP `/health` endpoint + shared liveness state (Level 1 mon.) |
| Metrics     | `src/metrics/`              | Prometheus `/metrics` registry + 5s sampler (Level 2 mon.)     |

### Key Types

Defined in `src/types.d.ts`:

- `Config` - Full configuration object
- `BlockJson` - Normalized block structure with txs and events
- `DecodedTx` - Decoded transaction with messages

Defined in `src/sink/types.ts`:

- `Sink` - Interface for output backends

### Key Implementation Patterns

**RPC Client** (`src/rpc/client.ts`):

- Undici agent with 128 connections pool, 10-60s keepalive
- Token bucket rate limiting (`src/rpc/ratelimit.ts`)
- Exponential backoff with jitter for 5xx/429 errors
- Broad transient classifier `isRetryableRpcError()` covers `fetch failed`,
  `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`,
  `UND_ERR_*`, HTTP 429/5xx — walks `error.cause` chain (undici wraps real
  cause inside `TypeError: fetch failed`)
- `waitForRpcStatus()` polls `/status` with infinite exponential backoff
  (capped at 30s) — used at startup, in follow loop, and indirectly by
  `syncRange` retry path. Indexer no longer crashes when archive node goes
  away; it pauses and resumes automatically.
- Updates `healthState.rpcReachable` so `/health` reflects the real archive
  node state.

**Bulk Mode** (`src/db/bulk-mode.ts`, `PG_BULK_MODE=true`):

- On startup: drops 33 secondary indexes and creates new range partitions
  as `UNLOGGED` (no WAL) — drastically speeds up backfill into ICS-era
  blocks (heights 18.5M+).
- On entering follow mode (or if `FOLLOW=false` exits): converts UNLOGGED
  partitions back to LOGGED and recreates indexes via `bulkModeOff()`.
- During `bulkModeOff()`, health phase is `maintenance`; stale block progress
  is allowed, `/health` exposes maintenance detail, and long `CREATE INDEX`
  operations log `pg_stat_progress_create_index` progress every 30s.
- Never drops primary keys.
- Updates `healthState.bulkMode` for `/health` reporting.

**Prometheus Metrics** (`src/metrics/`):

- `registry.ts` owns an isolated `prom-client` Registry (not the global one)
  with all `cdi_*` series — counters, histograms, gauges — plus
  `collectDefaultMetrics({prefix:'cdi_node_'})` for Node.js process stats.
- `sampler.ts` ticks every `METRICS_SAMPLE_INTERVAL_MS` (default 5000) to
  refresh pg pool stats, decode pool busy count, and the chain tip via
  `rpc.fetchStatus()` (single-in-flight, 4s timeout, `unref()`'d interval).
- Hook points: `src/sink/postgres.ts` (`observeFlush`), `src/rpc/client.ts`
  (`observeRpc` in try/finally around `getJson`), `src/runner/syncRange.ts`
  (`observeBlock`), `src/health/state.ts` (forwards `phase`, `bulk_mode`,
  `rpc_outage`, `indexed_height` to gauges so the existing state object is
  the single write site).
- Exposed at `GET /metrics` on the same `HEALTH_PORT` as `/health`.
- Cardinality discipline: only label by `module`, `level`, `endpoint`,
  `group`, `table`, `phase`. Never `height`, `tx_hash`, or `validator_addr`.

**Structured Logs** (`src/utils/logger.ts`):

- `LOG_FORMAT` env var (`pretty` | `json`, default `pretty`) chooses the
  Winston encoder explicitly — no auto-detection. `json` emits
  `{ts, level, label, message, metadata}` newline-delimited, ready for
  Loki / ELK ingestion.

**Health Endpoint** (`src/health/`):

- Lightweight node:http server on `HEALTH_PORT` (default 3000).
- `GET /health`, `/healthz` → 200/503 + JSON.
- Three checks: db query against `core.indexer_progress`, progress
  freshness (`now() - updated_at <= HEALTH_STALE_SECONDS`, default 180s),
  in-memory `rpcReachable` flag.
- 5-minute startup grace prevents flapping on cold starts.
- Tracks `phase` (`starting → backfill → maintenance → follow → shutdown`) and
  `bulk_mode`. State lives in `src/health/state.ts` and is mutated by
  `rpc/client.ts` and the runners (avoid circular imports).
- Wired to docker-compose `healthcheck:` so `restart: unless-stopped` will
  reboot the container if it stops making progress.

**Worker Thread Pool** (`src/decode/txPool.ts`):

- N workers from `txWorker.ts` using `node:worker_threads`
- Message passing for init/decode commands
- Progressive proto loading with progress callbacks

**Ordered Flushing Buffer** (`src/runner/syncRange.ts`):

- In-memory Map buffers completed blocks
- Flushes sequentially from `nextToFlush` height
- Preserves blockchain ordering despite concurrent fetching

**Follow Mode** (`src/runner/follow.ts`):

- Infinite polling loop for real-time indexing
- Jitter (0.8-1.2x interval) prevents request synchronization

### Sink Factory Pattern

`src/sink/index.ts` creates sink instances based on `SINK` env var:

- `stdout` - JSON lines to console
- `file` - Appends JSONL to file
- `postgres` - Batched inserts with domain-specific extractors
- `clickhouse` - Columnar analytics (placeholder)
- `null` - No-op for testing

### PostgreSQL Schema

Located in `initdb/`:

- **RANGE partitioning** by height (1M blocks per partition) for: blocks, transactions, messages, events, delegations, votes, etc.
- **HASH partitioning** by modulus (default 16) for `core.events`
- **Progress tracking** in `core.indexer_progress` for resumable indexing
- **Batch inserts** respect PostgreSQL 65535 parameter limit (`src/sink/pg/batch.ts`)

**Domain schemas**: `core`, `bank`, `stake`, `gov`, `ibc`, `wasm`, `authz_feegrant`, `groups`, `tokens`, `analytics`

---

## Configuration

Priority: CLI args > Environment variables > `.env` file > Defaults

All config validated at startup via Zod schema (`src/config/schema.ts`) with custom refinements.

Key variables (see `.env.example` for full list):

- `RPC_URL` - Blockchain RPC endpoint
- `FROM`, `TO` - Block range
- `RESUME=true` - Resume from last DB state
- `FOLLOW=true` - Follow new blocks after backfill
- `SINK=postgres` - Output backend
- `CONCURRENCY` - Max in-flight requests
- `RPS` - Requests per second limit
- `PG_*` - PostgreSQL connection settings
- `PG_BULK_MODE=true` - Drop indexes + UNLOGGED partitions for fast backfill,
  auto-restored when entering follow mode
- `HEALTH_PORT` (default 3000) - HTTP port for `/health` and `/metrics`
- `HEALTH_STALE_SECONDS` (default 180) - Block-progress freshness threshold
- `HEALTH_STARTUP_GRACE_SECONDS` (default 300) - No 503 during cold start
- `HEALTH_ENABLED` (default true) - Disable to skip starting the server
- `METRICS_ENABLED` (default true) - Toggle the Prometheus `/metrics` route + sampler
- `METRICS_SAMPLE_INTERVAL_MS` (default 5000) - Sampler refresh interval
- `LOG_FORMAT` (default `pretty`) - Set to `json` for machine-parseable logs (Loki/ELK)

---

## Code Style

- TypeScript strict mode with `noUncheckedIndexedAccess`
- ESM modules (ES2022 target)
- Prettier: semicolons, single quotes, trailing commas, 120 char width, arrow parens always
- No `console.log` - use Winston logger: `getLogger('module-name')` from `src/utils/logger.ts`
- Case conversion via `src/utils/case.ts`: preserves `@type` keys, deeply converts all object keys
- Use `.ts` extensions for local imports (enabled by `allowImportingTsExtensions`)

### Code Conventions

- **Early returns**: Prefer early returns for readability
- **Naming**: Use descriptive variable and function names
- **Types**: Define explicit types for internal structures; `any` acceptable for external/dynamic data (RPC responses, JSON) with justification
- **DRY principle**: Avoid code duplication
- **SOLID principles**: Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion

---

## Development Notes

- Uses `tsx` for direct TypeScript execution (no build step needed for dev)
- No test framework configured - add smoke tests for core logic changes
- Node.js 22+ recommended (v22.18.0 LTS)
- For memory-intensive runs: `export NODE_OPTIONS=--max-old-space-size=24576`
- `scripts/gen-known-msgs.ts` generates fast-path decoders for known Msg types — run before first start

---

## Main Rules

- Start by describing your plan of action and explaining why you made this decision
- Do not give high-level answers; provide specific solutions applicable to the project
- Focus on specific solutions, not abstract solutions
- Describe why you are making each change
- Before making changes, describe the general implementation plan point by point, then proceed
- Consider the linters, formatters, and project style when forming code
- If solving a complex, large-scale task, break down the solution into stages
- Keep solutions as simple as possible, focused only on what is actually needed
- Before writing and changing something, check environment, codebase and related code

---

## Code Implementation Guidelines

- Use early returns whenever possible to make the code more readable
- Use descriptive variable and function/const names
- Define types whenever possible - avoid using `any` or `unknown` without justification
- Fully implement all requested functionality - leave NO TODOs, placeholders or missing pieces
- Include all required imports and ensure proper naming of key components
- Follow existing patterns in the codebase (factory pattern for sinks, worker pools for CPU-intensive tasks)
- Handle errors appropriately with proper logging via Winston
- Use Zod for runtime validation of external data (RPC responses, config)
