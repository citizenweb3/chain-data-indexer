# miden-indexer

**Miden L2 indexer** for `miden-node 0.13.4`.

Live RPC target: `127.0.0.1:57291` using the public gRPC proto snapshot in `proto/`. The indexer follows a Miden node, stores explorer-visible chain data in Postgres, and serves a read-only HTTP API for explorer clients.

## Quickstart (dev)

```bash
cd /pool0/miden-indexer
npm ci
cp .env.example .env
# Edit .env for Postgres. Use a smoke DB, or start only Postgres with Docker:
# docker compose up -d postgres
npm run db:init
npm run dev
```

For full Docker deployment and operations, see [`docs/operations.md`](docs/operations.md).

## Configuration

Runtime configuration is validated in `src/config.ts`.

| Name | Default | Description |
|---|---|---|
| `NODE_URL` | `http://127.0.0.1:57291` | Public `miden-node` gRPC endpoint. |
| `DATABASE_URL` | unset | Optional full Postgres connection URL. When set, it takes precedence over `PG_*` fields. |
| `PG_HOST` | `localhost` | Postgres host used when `DATABASE_URL` is unset. |
| `PG_PORT` | `5432` | Postgres port used when `DATABASE_URL` is unset. |
| `PG_DB` | `miden_indexer` | Postgres database used when `DATABASE_URL` is unset. |
| `PG_USER` | `miden` | Postgres user used when `DATABASE_URL` is unset. |
| `PG_PASSWORD` | `CHANGE_ME` | Postgres password used when `DATABASE_URL` is unset. Change this outside local development. |
| `INDEXER_HTTP_PORT` | `3001` | HTTP port for `/health` and `/api/v1/*`. |
| `START_BLOCK` | unset | Optional first block number. When unset, the runner resumes from saved progress plus one. |
| `BATCH_SIZE` | `100` | Maximum number of blocks fetched and committed per range-sync batch. |
| `POLL_INTERVAL_MS` | `1500` | Live-follow polling interval in milliseconds; minimum accepted value is `100`. |
| `BACKFILL_CONCURRENCY` | `1` | Maximum concurrent RPC block fetches within one batch; max accepted value is `100`. |
| `MAX_LAG_BLOCKS_BEFORE_BATCH` | `5` | Lag threshold for switching follow mode from small batches to `BATCH_SIZE`. |
| `LOG_LEVEL` | `info` | Logger level: `debug`, `info`, `warn`, or `error`. |
| `LOG_FORMAT` | `pretty` | Log output format: `pretty` for local development, `json` (`{ts,level,label,message,metadata}`) for log shippers. |
| `METRICS_ENABLED` | `true` | Set to `false` to disable the Prometheus `/metrics` route and sampler. |
| `METRICS_SAMPLE_INTERVAL_MS` | `5000` | Interval for the metrics sampler that refreshes chain tip and pg pool gauges. |
| `API_BIND` | `0.0.0.0` | Bind address of the HTTP server inside the container; the API is fronted by nginx in production. |
| `PG_SSL` | `disable` | TLS mode for `PG_*` connections: `disable`, `require`, or `verify-full`. |
| `PG_SSL_CA` | unset | Path to a CA bundle when `PG_SSL` is `require` or `verify-full`. |

## Observability

`/metrics` exposes Prometheus text exposition with the fleet-wide `miden_*` prefix
(domain series) and `miden_node_*` prefix (Node.js runtime). See
[`docs/observability/`](docs/observability/) for ready-to-use Grafana Alloy,
Prometheus, and Promtail templates (env placeholders only — supply real URLs at
deploy time). Set `LOG_FORMAT=json` to enable structured logs for shipping to
Loki/ELK.

## API

The HTTP API is read-only. `/health` reports API/database health; versioned explorer endpoints live under `/api/v1` for stats, blocks, transactions, notes, nullifiers, and accounts.

See [`docs/indexer-api.md`](docs/indexer-api.md) for request/response contracts, pagination, encoding, and errors.

## Architecture

```text
miden-node
  → MidenRpcClient
  → Runner
  → Sink
  → Postgres ← API ← Explorer
```

- `src/rpc/client.ts` wraps live gRPC methods from `proto/`.
- `src/runner/` backfills to tip and poll-follows new blocks.
- `src/sink/postgres.ts` writes idempotent block bundles and progress.
- `src/api.ts` serves explorer queries from Postgres.

## Smoke tests

Run these with a live node at `NODE_URL` and a reachable Postgres database where required:

- `scripts/smoke-rpc.ts` — calls read-only public gRPC wrappers and verifies digest round-trip conversion.
- `scripts/smoke-sink.ts` — resets a smoke database, indexes recent blocks, checks `SHA-256(raw_block_bytes)` and duplicate-run idempotency.
- `scripts/smoke-runner.ts` — starts the runner against a smoke database and checks it reaches tip without gaps.
- `scripts/smoke-api.ts` — starts the HTTP API on an ephemeral port and checks documented endpoints and validation errors.

Example:

```bash
NODE_URL=http://127.0.0.1:57291 DATABASE_URL=postgres://miden:CHANGE_ME@localhost:5432/miden_indexer_smoke npx tsx scripts/smoke-rpc.ts
```

## Versioning

This monorepo uses one branch per network and protocol target. Examples include `logos-indexer-v0.1.2` and `miden-indexer-v0.13.4`.

Current Miden branch: `miden-indexer-v0.13.4`.
Supported node: `miden-node 0.13.4`.

For node-version bumps, follow [`docs/network-upgrades.md`](docs/network-upgrades.md).

## Contributing

Read [`AGENTS.md`](AGENTS.md) before changing code, schema, RPC behavior, operations, or docs. In particular, verify every protocol claim against `proto/`, keep sink/runner writes idempotent, and run `npm run build` for code changes.

## License

See [`LICENSE`](LICENSE).
