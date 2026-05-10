# monero-indexer

Production Monero explorer indexer for [ValidatorInfo](https://validatorinfo.com/).

It indexes blocks, transactions, canonical-chain state, and XMR supply checkpoints
from a Monero daemon into PostgreSQL and exposes a read-only explorer API.

**Supported:** monerod `v0.18.4.6`  
**Recommended node mode:** full archival node (required for historical supply backfill)

---

## What it indexes

| Data | Source | Table |
|---|---|---|
| Blocks (canonical + observed reorged rows) | `get_block` | `monero_blocks` |
| Raw transactions + safe summary fields | `/get_transactions` | `monero_transactions` |
| Resume position | internal | `monero_indexer_progress` |
| Supply checkpoints | `get_coinbase_tx_sum` | `monero_supply_checkpoints` |

Monero does **not** expose a stable validator identity. This branch does not
invent miner/pool validators from coinbase data.

---

## Prerequisites

- Node.js ≥ 20 with Corepack-enabled Yarn
- PostgreSQL ≥ 14
- A running Monero daemon reachable at `NODE_URL`
- **Archival sync completed** if you want historical supply backfill

---

## Quick start

```bash
# 1. Enable Corepack + install dependencies
corepack enable
yarn install

# 2. Configure
cp .env.example .env
# Edit .env: set PG_PASSWORD and NODE_URL

# 3. Initialise database
yarn db:init

# 4. Run (dev mode)
yarn dev

# 5. Build and run (production)
yarn build
yarn start
```

### With Docker Compose

```bash
cp .env.example .env
docker compose up -d --build
```

---

## Configuration

See [`.env.example`](.env.example) for all options.

| Variable | Default | Description |
|---|---|---|
| `NODE_URL` | `http://localhost:18089` | Monero daemon RPC endpoint |
| `PG_*` | see `.env.example` | PostgreSQL connection |
| `FROM_HEIGHT` | `0` | Start height when no saved progress exists |
| `FOLLOW` | `true` | Poll for new blocks after backfill |
| `BATCH_SIZE` | `200` | Heights per backfill batch |
| `RPC_CONCURRENCY` | `16` | Concurrent `get_block` requests per batch |
| `TX_BATCH_SIZE` | `200` | Transaction hashes per `/get_transactions` request |
| `FOLLOW_POLL_INTERVAL_MS` | `10000` | Poll interval for new heights |
| `SETTLEMENT_DEPTH` | `20` | Depth used for `is_settled` and supply updates |
| `SUPPLY_ENABLED` | `true` | Enable supply bootstrap/hourly maintenance |
| `SUPPLY_CHUNK_SIZE` | `25000` | Blocks per `get_coinbase_tx_sum` chunk |
| `SUPPLY_UPDATE_INTERVAL_MS` | `3600000` | Supply updater interval |
| `HEALTH_MAX_LAG_BLOCKS` | `50` | Lag threshold for `/health` degradation |
| `HEALTH_MAX_STALL_MS` | `300000` | Progress-age threshold for `/health` degradation |
| `API_*` | see `.env.example` | Explorer API/health listener |
| `METRICS_ENABLED` | `true` | Enable `GET /metrics` |

---

## Architecture

```text
src/
├── index.ts               entry point: wait for node → backfill → follow + supply scheduler
├── config.ts              env-based config (zod)
├── types.d.ts             Monero RPC + DB types
├── api.ts                 explorer API + /health + /metrics + /openapi.json + /docs
├── openapi.ts             static OpenAPI contract + Swagger UI HTML
├── rpc/client.ts          Monero JSON-RPC + path RPC wrapper with retry and big-int safe parsing
├── metrics/               isolated Prometheus registry + sampler
├── db/
│   ├── pg.ts              PostgreSQL pool
│   └── progress.ts        resume position (height + hash, always-forward)
├── sink/postgres.ts       atomic block/tx writes + supply checkpoint writes
├── runner/
│   ├── syncRange.ts       height-range backfill with reorg detection
│   ├── follow.ts          poll-based live follow
│   ├── canonicalChain.ts  canonical flag + settlement updates
│   ├── supplyBackfill.ts  chunked supply checkpoint builder
│   └── supplyHourly.ts    periodic supply maintenance
└── txDecode.ts            safe Monero tx summary (fee/input/output counts, no invented semantics)
```

---

## Explorer API

The indexer exposes:

| Endpoint | Description |
|---|---|
| `GET /health` | DB/node reachability, lag, sync status, prune status |
| `GET /metrics` | Prometheus metrics |
| `GET /openapi.json` | OpenAPI 3.1 contract |
| `GET /docs` | Swagger UI |
| `GET /api/v1/stats` | Network/indexer summary |
| `GET /api/v1/blocks` | Paginated block list |
| `GET /api/v1/blocks/:id` | Block detail by hash or canonical height |
| `GET /api/v1/transactions` | Paginated transaction list |
| `GET /api/v1/transactions/:id` | Transaction detail by hash |
| `GET /api/v1/supply` | Paginated supply checkpoint series |

Unversioned `/api/*` routes remain local aliases; new clients should use `/api/v1/*`.

Full endpoint details: [`docs/indexer-api.md`](docs/indexer-api.md)

---

## Metrics and logs

Prometheus metrics are exposed at `GET /metrics` on `API_PORT` when
`METRICS_ENABLED=true`. Domain series use the `monero_` prefix; Node.js runtime
series use `monero_node_`.

For production log shipping, set `LOG_FORMAT=json` to emit one JSON object per line:

```json
{"ts":"2026-01-01T00:00:00.000Z","level":"info","label":"monero-indexer","message":"Database connected","metadata":{}}
```

---

## Key product note: supply

`totalSupply` is built from `get_coinbase_tx_sum`, but **only**
`emission_amount` counts toward supply. `fee_amount` is stored for diagnostics
and audit, not added to XMR issuance.

The indexer does **not** run one giant full-range supply query every hour.
Instead it:

1. waits for an archival node,
2. backfills supply in chunks,
3. stores checkpoints with `(height, block_hash, cumulative_emission_atomic)`,
4. verifies checkpoint hashes before appending more,
5. extends only from the last valid checkpoint to the new settled tip.

---

## Operations and upgrade docs

- [`docs/api.md`](docs/api.md) — upstream Monero RPC surface used by the indexer
- [`docs/indexer-api.md`](docs/indexer-api.md) — explorer API contract
- [`docs/operations.md`](docs/operations.md) — env vars, Docker, health, metrics
- [`docs/network-upgrades.md`](docs/network-upgrades.md) — monerod upgrade workflow
- [`docs/future.md`](docs/future.md) — explicit non-goals / deferred work
- [`AGENTS.md`](AGENTS.md) — contributor/agent workflow
