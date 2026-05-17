# Crosschain IBC Indexer

Cross-chain IBC analytics and explorer stack for Cosmos Hub transfer flows.

This branch combines a **Next.js 16 dashboard + read-only API** with a **Node worker**
that syncs IBC transfers from an upstream `chain-data-indexer` API deployment into
PostgreSQL, recomputes daily rollups, and enriches seeded assets with CoinGecko pricing.

**Branch status:** Development

**Live application:** [ibc.validatorinfo.com](https://ibc.validatorinfo.com)

## CDI repository context

This branch is part of the [`citizenweb3/chain-data-indexer`](https://github.com/citizenweb3/chain-data-indexer)
branch family. The repository map lives in
[`main`](https://github.com/citizenweb3/chain-data-indexer/tree/main).

| Related component | Branch | Status | Role |
|---|---|---|---|
| Cosmos Hub indexer | [`main`](https://github.com/citizenweb3/chain-data-indexer/tree/main) | Production | Canonical Cosmos Hub block/tx indexer |
| Cosmos Indexer API | [`cosmos-indexer-api`](https://github.com/citizenweb3/chain-data-indexer/tree/cosmos-indexer-api) | Production | Read-only API wrapper over the Cosmos indexer database |
| Aztec indexer | [`aztec`](https://github.com/citizenweb3/chain-data-indexer/tree/aztec) | Production | Aztec explorer/indexer stack |
| Logos indexer | [`logos-indexer-v0.1.2`](https://github.com/citizenweb3/chain-data-indexer/tree/logos-indexer-v0.1.2) | Development | Logos testnet block + explorer indexer |
| Monero indexer | [`monero-indexer`](https://github.com/citizenweb3/chain-data-indexer/tree/monero-indexer) | Development | Monero explorer indexer |
| Polygon Miden indexer | [`miden-indexer-v0.13.4`](https://github.com/citizenweb3/chain-data-indexer/tree/miden-indexer-v0.13.4) | Development | Miden L2 indexer and explorer API |

## What this branch does

| Layer | Purpose |
|---|---|
| **Worker** | Pulls IBC transfer data from an upstream indexer API, stores packets, recomputes rollups, and refreshes prices |
| **PostgreSQL warehouse** | Stores transfers, per-day statistics, assets, prices, and sync cursors |
| **Web app** | Serves dashboard pages, transfer/channel explorers, and API docs |
| **Read-only API** | Exposes stats, channels, assets, transfers, timeseries, health, and OpenAPI |

## Data model

| Data | Table |
|---|---|
| Raw IBC packet / transfer rows | `ibc_packets` |
| Seeded and normalized asset metadata | `assets` |
| Latest spot prices | `prices` |
| Historical price snapshots | `price_history` |
| UTC daily transfer rollups | `ibc_daily_stats` |
| Worker progress watermarks | `sync_cursors` |

## User-facing surface

### Pages

- `/dashboard` — top-level KPIs, channels, top assets, and timeseries
- `/channels/[channel]?port=...` — per-channel detail view
- `/assets` — asset breakdowns
- `/transfers` — paginated transfer explorer
- `/transfers/[port]/[channel]/[sequence]` — transfer detail
- `/docs` — Scalar API docs UI

`/` redirects to `/dashboard`.

### API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/v1/health` | Database + sync watermark health |
| `GET` | `/api/v1/stats` | Aggregate stats for a selected period |
| `GET` | `/api/v1/channels` | Channel rankings and channel summaries |
| `GET` | `/api/v1/assets` | Asset breakdown and pricing-aware summaries |
| `GET` | `/api/v1/timeseries` | Transfers / volume time series |
| `GET` | `/api/v1/transfers` | Transfer list with filters and pagination |
| `GET` | `/api/v1/transfers/:port/:channel/:sequence` | Transfer detail |
| `GET` | `/api/openapi.json` | OpenAPI document |

## Quick start

### Docker Compose

```bash
cp .env.example .env
# Edit .env with real upstream URL, API key, and DB credentials if needed
docker compose up -d --build
```

This starts:

1. `postgres`
2. one-shot `migrations` (`yarn db:deploy && yarn db:seed`)
3. `web`
4. `worker`

### Local development

```bash
docker compose up -d postgres
yarn install --frozen-lockfile
cp .env.example .env
# For host-side Prisma/Next, switch DATABASE_URL from @postgres to @localhost
yarn db:deploy
yarn db:seed
yarn dev:worker
yarn dev
```

Then open:

- `http://localhost:3000/dashboard`
- `http://localhost:3000/docs`
- `http://localhost:3000/api/openapi.json`

## Worker jobs

The worker registers recurring jobs from `server/indexer.ts`:

- `sync-ibc-transfers` — fetches fresh transfer pages from the upstream API
- `recompute-daily-stats` — rebuilds UTC daily aggregates
- `prices` — refreshes latest CoinGecko spot prices
- `price-history` — stores periodic price history snapshots

All database writes belong to the worker; the web/API side stays read-only.

## Configuration

Copy `.env.example` to `.env`.

| Variable | Required | Description |
|---|---:|---|
| `POSTGRES_DB` | Yes | Postgres database name for local/docker runs |
| `POSTGRES_USER` | Yes | Postgres user |
| `POSTGRES_PASSWORD` | Yes | Postgres password |
| `DATABASE_URL` | Yes | Connection string for `web`, `worker`, and Prisma |
| `UPSTREAM_INDEXER_BASE_URL` | Yes | Upstream `chain-data-indexer` API root used by the worker |
| `UPSTREAM_INDEXER_API_KEY` | Yes | API key for upstream transfer sync |
| `COINGECKO_API_KEY` | No | Optional CoinGecko key; empty falls back to the public free tier |
| `LOG_LEVEL` | No | Pino log level, defaults to `info` |
| `PORT` | No | Web port, defaults to `3000` |

## Operations and validation

- Smoke validation notes live in [`docs/smoke-test.md`](docs/smoke-test.md).
- Module-specific implementation rules live in [`AGENTS.md`](AGENTS.md) and the nested `AGENTS.md` files under `src/`.
- The worker expects a healthy upstream indexer API and a reachable PostgreSQL instance before it can make progress.

## Contributing

Read [`AGENTS.md`](AGENTS.md) before changing the worker, schemas, API handlers, SQL, or UI. Keep the web layer read-only, route all database writes through the worker flow, and preserve string serialization for large numeric amounts in API responses.

## License

This branch is licensed under the MIT License. See [`LICENSE`](LICENSE).
