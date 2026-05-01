# logos-indexer

Block indexer for the [Logos Blockchain](https://github.com/logos-blockchain/logos-blockchain) testnet.

Indexes all blocks and proof-of-leadership key diagnostics from a local Logos node into PostgreSQL.
Designed for integration with the [validatorinfo](https://validatorinfo.com) explorer.

**Supported:** Logos testnet v0.1.2+

---

## What it indexes

| Data | Source | Table |
|---|---|---|
| All blocks (slot, height, leader, raw JSON) | `/cryptarchia/blocks` | `logos_blocks` |
| Block finality status | `/cryptarchia/lib-stream` header IDs + parent chain | `logos_blocks.finalized` |
| Proof leader-key diagnostics (first/last seen slot) | `proof_of_leadership.leader_key` | `logos_leaders` |
| Indexer resume position | internal | `logos_indexer_progress` |

Transactions and wallet balances are not indexed in v0.1.2 — see [`docs/future.md`](docs/future.md).

Logos v0.1.2 block headers do **not** expose a stable validator identity.
`proof_of_leadership.leader_key` is a proof/signing key observed in the block
header; on the current testnet dataset every indexed block has a distinct key.
Do not use it as a validator/account identifier.

Logos v0.1.2 `/cryptarchia/blocks` also omits per-block height. Finality is
therefore tracked by `/cryptarchia/lib-stream` `header_id` and the stored
`parent_block` chain, not by comparing heights.

---

## Prerequisites

- Node.js ≥ 20 with npm
- PostgreSQL ≥ 14
- A running Logos node (v0.1.2 testnet) accessible at `NODE_URL`

---

## Quick start

```bash
# 1. Install dependencies
npm install

# 2. Configure
cp .env.example .env
# Edit .env: set PG_PASSWORD and NODE_URL

# 3. Initialise database
psql "postgresql://$PG_USER:$PG_PASSWORD@$PG_HOST:$PG_PORT/$PG_DB" -f initdb/001-schema.sql

# 4. Run (dev mode)
npm run dev

# 5. Build and run (production)
npm run build
npm start
```

### With Docker Compose

```bash
cp .env.example .env   # set PG_PASSWORD
docker compose up -d
```

---

## Configuration

See [`.env.example`](.env.example) for all options.

| Variable | Default | Description |
|---|---|---|
| `NODE_URL` | `http://localhost:8080` | Logos node HTTP API |
| `PG_*` | see .env.example | PostgreSQL connection |
| `PG_HOST_BIND` | `127.0.0.1` | Docker Compose bind address for PostgreSQL |
| `PG_HOST_PORT` | `5432` | Docker Compose host port for PostgreSQL |
| `PG_SSL` | `false` | Enable TLS for remote PostgreSQL connections |
| `PG_SSL_CA` | unset | Optional CA certificate path for `PG_SSL=true` |
| `FROM_SLOT` | `0` | Start slot (overridden by saved progress) |
| `FOLLOW` | `true` | Subscribe to live blocks after backfill |
| `BATCH_SIZE` | `500` | Slots per backfill request |
| `LOG_LEVEL` | `info` | `debug` / `info` / `warn` / `error` |
| `LOG_FORMAT` | `pretty` | `pretty` for terminals, `json` for log shipping |
| `API_BIND` | `0.0.0.0` | Internal listener host for health, metrics, and API |
| `API_PORT` | `3001` | HTTP port for `GET /health` and `GET /api/*` |
| `API_HOST_BIND` | `0.0.0.0` | Docker Compose bind address for the public indexer API |
| `API_HOST_PORT` | `3001` | Docker Compose host port for the indexer API |
| `METRICS_ENABLED` | `true` | Enable `GET /metrics` Prometheus endpoint |
| `METRICS_SAMPLE_INTERVAL_MS` | `5000` | Interval for node tip and PG pool metric sampling |

---

## Architecture

```
src/
├── index.ts             Entry point: wait for Online → backfill → follow + followLib
├── config.ts            Env-based config (zod)
├── types.d.ts           Logos API types (incl. LibStreamEvent)
├── api.ts               HTTP explorer API + health server
├── rpc/client.ts        HTTP client: REST + NDJSON streams (blocks + lib-stream)
├── metrics/             Isolated Prometheus registry + sampler
├── db/
│   ├── pg.ts            PostgreSQL pool (with error handler)
│   └── progress.ts      Resume: last indexed slot (UPSERT + GREATEST)
├── sink/postgres.ts     processBlock (tx), processBatch (bulk unnest), markBlocksFinalized
├── runner/
│   ├── syncRange.ts     Slot-range backfill with retry + resume
│   ├── follow.ts        block-stream follower: gap-fill → subscribe → serial queue + exp. backoff
│   └── followLib.ts     LIB NDJSON follower: marks blocks finalized
└── utils/
    ├── logger.ts        Winston logger (Error-safe JSON)
    └── retry.ts         withRetry: exp. backoff, retries only transient errors
```

---

## Explorer API

The indexer exposes an HTTP API for explorer frontends on `API_PORT` (default `3001`).
Full endpoint schemas, parameters, response fields, and error responses are in
[`docs/indexer-api.md`](docs/indexer-api.md).

| Endpoint | Description |
|---|---|
| `GET /api/v1/stats` | Network/indexer summary: counts, latest slots/heights, lag |
| `GET /api/v1/blocks?limit=20&offset=0&finalized=true&order=desc` | Blocks sorted by numeric slot (`finalized=all` includes non-finalized blocks) |
| `GET /api/v1/blocks/:id` | Block detail by `header.id`, including raw block JSON |
| `GET /api/v1/leader-keys?limit=20&offset=0` | Proof leader keys ordered by observed block count |
| `GET /api/v1/leader-keys/:leader_key` | Diagnostics for one proof leader key |
| `GET /api/v1/leader-keys/:leader_key/blocks` | Blocks carrying one proof leader key |

Example:

```bash
curl "http://localhost:3001/api/v1/blocks?limit=20&finalized=true&order=desc"
curl http://localhost:3001/api/v1/stats
```

Unversioned `/api/*` routes are kept as aliases for local tooling.
Use `/api/v1/*` for all new code.

---

## Explorer SQL queries

```sql
-- Latest blocks (finalized only)
SELECT slot, height, leader_key, tx_count, indexed_at
FROM logos_blocks WHERE finalized ORDER BY slot DESC LIMIT 20;

-- Proof leader keys by observed block count.
-- These are not stable validator identities in Logos v0.1.2.
SELECT leader_key,
       blocks_produced AS blocks_with_key,
       first_block_slot AS first_seen_slot,
       last_block_slot AS last_seen_slot
FROM logos_leaders ORDER BY blocks_produced DESC LIMIT 20;

-- Network summary
SELECT COUNT(*) AS total_blocks,
       COUNT(*) FILTER (WHERE finalized) AS finalized_blocks,
       MAX(slot) AS latest_slot,
       MAX(height) AS latest_height
FROM logos_blocks;
```

---

## Metrics and logs

Prometheus metrics are exposed at `GET /metrics` on `API_PORT` when
`METRICS_ENABLED=true`. Domain series use `logos_`; Node.js runtime series use
`logos_node_`. Production log shipping should set `LOG_FORMAT=json` to emit one
structured object per line with `ts`, `level`, `label`, `message`, and
`metadata`. See [`docs/operations.md`](docs/operations.md) and
[`docs/observability/`](docs/observability/) for integration examples.

---

## Health check

```bash
curl http://localhost:3001/health
```
```json
{
  "status": "ok",
  "last_slot": 1148474,
  "node_tip_slot": 1148480,
  "node_height": 58062,
  "node_mode": "Online",
  "lag_slots": 6,
  "uptime_s": 3600
}
```
Returns `200` when healthy, `503` when node unreachable. Useful for Docker / K8s liveness probes.

---

## Operations and upgrades

- [`docs/operations.md`](docs/operations.md) — environment variables, Docker
  networking, health interpretation, troubleshooting, and deployment notes.
- [`docs/network-upgrades.md`](docs/network-upgrades.md) — release upgrade
  checklist for future Logos network versions.
- [`docs/api.md`](docs/api.md) — upstream Logos node API consumed by the indexer.
- [`docs/future.md`](docs/future.md) — deliberately deferred transaction and
  balance work.

---

## Future work

See [`docs/future.md`](docs/future.md) for the v0.2+ roadmap:
- Transaction indexing (when `block.transactions[]` becomes non-empty)
- UTXO note tracking
- Wallet balance display (pending public API support)

---

## Agent workflow

See [`AGENTS.md`](AGENTS.md) for sub-agent roles and constraints when working on this codebase.
