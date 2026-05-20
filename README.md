# atomone-indexer

Production AtomOne mainnet indexer for [ValidatorInfo](https://validatorinfo.com/).

It follows an AtomOne RPC endpoint, decodes blocks and transactions, and stores explorer-facing data in PostgreSQL.
This branch covers core chain data plus banking, staking, governance, IBC, wasm, authz/feegrant, groups, token flows,
health checks, and Prometheus metrics.

**Supported:** AtomOne mainnet (`atomone-1`)  
**Branch status:** Production

## CDI repository context

This branch is part of the [`citizenweb3/chain-data-indexer`](https://github.com/citizenweb3/chain-data-indexer)
branch family. The repository map lives in
[`main`](https://github.com/citizenweb3/chain-data-indexer/tree/main).

The public AtomOne API wrapper lives in
[`atomone-indexer-api`](https://github.com/citizenweb3/chain-data-indexer/tree/atomone-indexer-api).
Its public docs are available at <https://indexer.atomone.citizenweb3.com/docs>; main API access is whitelist/token protected.

| Related indexer | Branch | Status |
|---|---|---|
| Cosmos Hub | [`main`](https://github.com/citizenweb3/chain-data-indexer/tree/main) | Production |
| Aztec Protocol | [`aztec`](https://github.com/citizenweb3/chain-data-indexer/tree/aztec) | Production |
| Logos | [`logos-indexer-v0.1.2`](https://github.com/citizenweb3/chain-data-indexer/tree/logos-indexer-v0.1.2) | Development |
| Monero | [`monero-indexer`](https://github.com/citizenweb3/chain-data-indexer/tree/monero-indexer) | Development |
| Polygon Miden | [`miden-indexer-v0.13.4`](https://github.com/citizenweb3/chain-data-indexer/tree/miden-indexer-v0.13.4) | Development |

## What it indexes

| Data | Table / schema |
|---|---|
| Canonical blocks, validator set snapshots, missed blocks, and chain params | `core.*` |
| Transactions, decoded messages, events, and event attributes | `core.transactions`, `core.messages`, `core.events`, `core.event_attrs` |
| Bank transfers and balance deltas/current balances | `bank.*` |
| Delegation and reward-distribution events/current staking state | `stake.*` |
| Governance proposals, deposits, and votes | `gov.*` |
| IBC channels, packet lifecycle rows, and denom traces | `ibc.*` |
| Wasm code/contracts/executions/events/state and CW20 transfers/balances | `wasm.*`, `tokens.*` |
| Authz grants, fee grants, and group module objects | `authz_feegrant.*`, `groups.*` |
| Daily analytics rollups | `analytics.*` |
| Resume position | `core.indexer_progress` |

## Features

- Resumable backfills and follow mode against AtomOne RPC.
- Parallel transaction decoding with worker threads.
- PostgreSQL partitioning and optional bulk ingest mode for large backfills.
- Health endpoint on `HEALTH_PORT` and Prometheus metrics on `/metrics`.
- Structured logging with `LOG_FORMAT=pretty|json`.
- Docker Compose workflow for Postgres + indexer, plus host-run dev mode.
- Separate companion API branch for explorer/consumer access.

## Quick start

### Local development

```bash
yarn install --frozen-lockfile
cp .env.example .env
# Edit .env for RPC_URL and Postgres access
make up
yarn dev
```

### Docker Compose

```bash
cp .env.example .env
docker compose --env-file .env up --build -d
```

Useful endpoints after startup:

- `http://127.0.0.1:${HEALTH_PORT:-3031}/health`
- `http://127.0.0.1:${HEALTH_PORT:-3031}/metrics`

## Configuration

All runtime configuration is driven by `.env.example`.

| Variable | Description | Example |
|---|---|---|
| `RPC_URL` | AtomOne RPC endpoint | `http://192.168.5.218:26957` |
| `FROM` / `TO` | Backfill height range | `1`, `10000`, or `latest` |
| `RESUME` | Resume from `core.indexer_progress` | `true` / `false` |
| `FOLLOW` / `FOLLOW_INTERVAL_MS` | Continue polling after catch-up | `true`, `5000` |
| `CONCURRENCY` / `DECODE_WORKERS` | Fetch + decode parallelism | `16`, `40` |
| `RPS` / `RETRIES` / `BACKOFF_MS` | RPC throttling and retry policy | `100`, `3`, `250` |
| `SINK` | Output sink kind | `postgres` |
| `PG_DB` / `PG_USER` / `PG_PASSWORD` / `PG_PORT` | Postgres connection settings | `atomone_indexer_db`, `atomone_indexer_user`, `2433` |
| `PG_BULK_MODE` | Drop heavy secondary indexes for initial backfill | `true` / `false` |
| `HEALTH_PORT` / `HEALTH_ENABLED` | Health server configuration | `3031`, `true` |
| `METRICS_ENABLED` | Expose Prometheus metrics on `/metrics` | `true` |
| `LOG_LEVEL` / `LOG_FORMAT` | Log verbosity and output format | `info`, `pretty` |

## Operations notes

- `make up`, `make down`, `make reset`, `make logs`, and `make psql` are the main local DB helpers.
- `PG_BULK_MODE=true` is intended for large initial backfills; heavy indexes are restored automatically when the indexer transitions into follow mode.
- Health degrades if indexed height stops advancing beyond `HEALTH_STALE_SECONDS`, unless the process is still in startup grace or maintenance.
- Observability examples live under [`docs/observability/`](docs/observability/).

## Development commands

```bash
yarn dev
yarn start
yarn build
yarn typecheck
```

## Contributing

Read [`AGENTS.md`](AGENTS.md) before changing decoding, sink, RPC, health, metrics, or schema logic. Keep the indexer resumable, avoid breaking partition assumptions, and preserve string-safe handling for large numeric fields through the storage and API boundary.

## License

This branch is licensed under the MIT License. See [`LICENSE`](LICENSE).
  See the **Monitoring & Maintenance** section in [DEPLOYMENT.md](DEPLOYMENT.md).
- Need Prometheus metrics or log shipping? `curl http://127.0.0.1:${HEALTH_PORT:-3000}/metrics`
  for the `cdi_*` series, set `LOG_FORMAT=json` for structured logs, and use
  the reference collector configs in [`docs/observability/`](docs/observability/)
  (Grafana Alloy or classic Prometheus + Promtail).
- RPC archive node temporarily unavailable? The indexer now waits and resumes
  automatically (no crash loop) — see logs for `[rpc] startup: RPC unavailable`
  / `RPC is available again`.

---

## Development Notes

- Runs TypeScript directly via `tsx` during development.
- No tests by default; please add smoke tests for core logic changes.
- See Makefile and Docker Compose files for advanced operations.

---

## Contributing

Contributions are welcome!  
Open issues/PRs for improvements, bug fixes, or new features.

For significant changes, please open an issue to discuss your ideas first.

---

## License

[`BE GOOD` License](LICENSE-BG) for details.

---
