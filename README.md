# Aztec Blockchain Indexer

> Production Aztec L2 indexer branch in the Chain Data Indexer family.

This branch contains the Aztec indexer stack used to ingest Aztec L2 data, publish events, and serve explorer APIs.
It is a heavily reworked Chicmoz-based stack with its own listener, API service, databases, queueing, health checks,
metrics, and deployment runbook.

## CDI repository context

This branch is part of the [`citizenweb3/chain-data-indexer`](https://github.com/citizenweb3/chain-data-indexer)
branch family. The repository map lives in
[`main`](https://github.com/citizenweb3/chain-data-indexer/tree/main). The Aztec API is built into this branch.

## What runs in this branch

| Component | Purpose |
|---|---|
| `aztec-listener` | Polls Aztec RPC nodes, indexes proposed/proven blocks, pending transactions, chain info, and publishes events to Kafka. |
| `explorer-api` | Serves REST API routes for indexed Aztec data and consumes Kafka events into API-facing storage. |
| `migrations` | One-shot migration container. It is expected to complete successfully and exit. |
| `postgres` | Stores listener and explorer API data. |
| `redis` | Cache layer for the explorer API. |
| `kafka` + `zookeeper` | Event bus between listener, API, and supporting services. |
| `kafka-ui` | Optional debug UI, enabled by the `debug` command/profile. |

## Requirements

- Docker with Compose support.
- A working Aztec RPC endpoint.
- Enough disk space for image builds and indexed data.

## Quick start

1. Create the runtime environment file:

   ```bash
   cp .env.indexer.example .env.indexer
   ```

2. Set at minimum:

   ```bash
   AZTEC_RPC_URLS=mainnet::https://your-aztec-rpc
   L2_NETWORK_ID=MAINNET
   NODE_ENV=production
   AZTEC_LISTENER_INSTANCE_NAME=aztec-listener-1
   EXPLORER_API_INSTANCE_NAME=explorer-api-1
   PUBLIC_API_KEY=dev-api-key
   POSTGRES_USER=chicmoz
   POSTGRES_PASSWORD=strong-password
   ```

3. Start the stack:

   ```bash
   ./run-indexer.sh start
   ```

4. Check service status and logs:

   ```bash
   ./run-indexer.sh status
   ./run-indexer.sh logs
   ./run-indexer.sh logs listener
   ./run-indexer.sh logs api
   ```

5. Verify HTTP endpoints:

   ```bash
   curl http://localhost:8000/health
   curl http://localhost:8000/l2/index
   curl "http://localhost:8000/l2/blocks?limit=5"
   curl http://127.0.0.1:8001/metrics
   ```

## Operator commands

All runtime commands go through `run-indexer.sh`, which wraps `docker compose --env-file .env.indexer -f
docker-compose.indexer.yml`.

| Command | Description |
|---|---|
| `./run-indexer.sh start` | Build and start the stack in the background. |
| `./run-indexer.sh stop` | Stop the stack and remove orphan containers. |
| `./run-indexer.sh restart` | Stop, rebuild, and start the stack. |
| `./run-indexer.sh status` | Show container status. |
| `./run-indexer.sh logs` | Tail logs for all services. |
| `./run-indexer.sh logs listener` | Tail `aztec-listener` logs. |
| `./run-indexer.sh logs api` | Tail `explorer-api` logs. |
| `./run-indexer.sh debug` | Start the stack with the Kafka UI profile enabled. |
| `./run-indexer.sh reset` | Stop the stack and delete volumes. |
| `./run-indexer.sh config` | Render the final Docker Compose configuration. |

Service aliases for logs: `listener`, `api`, `db`, `redis`, `kafka`, `zookeeper`, `migrations`, `kafka-ui`.

## Runtime architecture

The primary deployment path is Docker Compose via `docker-compose.indexer.yml`.

| Service | Container | Host access |
|---|---|---|
| PostgreSQL | `aztec-indexer-postgres` | `${POSTGRES_PORT:-5439}` -> `5432` |
| Explorer API | `aztec-indexer-api` | `${API_PORT:-8000}` -> `8000` |
| Listener health/metrics | `aztec-indexer-listener` | `127.0.0.1:${LISTENER_METRICS_HOST_PORT:-8001}` -> `${LISTENER_HEALTH_PORT:-8000}` |
| Kafka UI | `aztec-indexer-kafka-ui` | `${KAFKA_UI_PORT:-8081}` -> `8080`, debug profile only |

The listener metrics/health port is loopback-only by design. Host-level Prometheus, Grafana Alloy, or another collector
should scrape it from `127.0.0.1`.

## Configuration

Configuration lives in `.env.indexer`; use `.env.indexer.example` as the template.

| Variable | Required | Description |
|---|---:|---|
| `AZTEC_RPC_URLS` | Yes | One or more Aztec RPC nodes in `name::url` format, comma-separated for failover. |
| `L2_NETWORK_ID` | Yes | `MAINNET`, `TESTNET`, `DEVNET`, `SANDBOX`, or a custom identifier. |
| `PUBLIC_API_KEY` | Yes | API key used by legacy `/v1/<apiKey>/l2/*` routes and OpenAPI links. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` | Yes | Database credentials for the bundled PostgreSQL service. |
| `API_PORT` | No | Host port for `explorer-api`; default `8000`. |
| `LISTENER_METRICS_HOST_PORT` | No | Loopback host port for listener `/health` and `/metrics`; default `8001`. |
| `KAFKA_UI_PORT` | No | Host port for optional Kafka UI; default `8081`. |
| `LOG_FORMAT` | No | `pretty` for local development, `json` for production/Loki ingestion. |
| `METRICS_SAMPLE_INTERVAL_MS` | No | In-process metrics sampling interval. |
| `BLOCK_FETCHER_WORKERS`, `BLOCK_BATCH_SIZE`, `BLOCK_PREFETCH_SIZE` | No | Listener throughput tuning knobs. |

Advanced options in `.env.indexer.example` include forced start heights, processed-height reset, eternal catchup toggle,
RPC rate limits, PostgreSQL pool sizes, and shutdown timeout.

## Health and metrics

| Service | Endpoint | Meaning |
|---|---|---|
| Explorer API | `GET http://localhost:8000/health` | API is healthy when PostgreSQL is reachable. |
| Explorer API | `GET http://localhost:8000/metrics` | Prometheus metrics for API HTTP, Kafka consumer, and process state. |
| Aztec listener | `GET http://127.0.0.1:8001/health` | Listener is healthy when PostgreSQL and at least one RPC node are healthy. |
| Aztec listener | `GET http://127.0.0.1:8001/metrics` | Prometheus metrics for block ingestion, RPC, Kafka publishing, and process state. |

For full observability setup, see [MONITORING.md](MONITORING.md). The compose stack does not bundle Prometheus or Alloy;
collectors are expected to run on the host.

## Explorer API

The API is exposed by `explorer-api` on `API_PORT` (`8000` by default).

Core routes are available directly under `/l2/*`, and legacy compatibility routes are available under
`/v1/<PUBLIC_API_KEY>/l2/*`.

Useful entry points:

```bash
curl http://localhost:8000/l2/index
curl http://localhost:8000/open-api-specification
curl http://localhost:8000/v1/dev-api-key/l2/index
```

Common route groups:

| Route | Description |
|---|---|
| `/l2/latest-height` | Latest indexed L2 height. |
| `/l2/blocks/latest` | Latest indexed block. |
| `/l2/blocks` | Paginated block list. |
| `/l2/blocks/:heightOrHash` | Block detail by height or hash. |
| `/l2/blocks/by-status`, `/l2/blocks/orphaned`, `/l2/blocks/orphans` | Block status and orphan/reorg views. |
| `/l2/reorgs` | Reorg data. |
| `/l2/tx-effects` | Transaction effects list. |
| `/l2/blocks/:blockHeight/tx-effects` | Transaction effects in a block. |
| `/l2/tx-effects/:txEffectHash` | Transaction effect detail. |
| `/l2/txs`, `/l2/txs/:txEffectHash`, `/l2/dropped-txs/:txEffectHash` | Transaction and dropped-transaction views. |
| Contract, class, instance, search, stats, L1, validators, and sequencers routes | Additional explorer API groups implemented by `services/explorer-api`. |

## Development commands

The repository is a Yarn workspace project.

| Command | Description |
|---|---|
| `yarn build` | Build all workspaces. |
| `yarn lint` | Lint all workspaces. |
| `yarn test` | Run workspace test suites. |
| `yarn build:packages` | Build shared `@chicmoz-pkg/*` packages. |
| `yarn lint:packages` | Lint shared `@chicmoz-pkg/*` packages. |

For local Kubernetes/Skaffold development, see [INDEXER.md](INDEXER.md) and the service-level documentation.

## Operations and documentation

- [RUNBOOK.md](RUNBOOK.md) - start, verify, restart, troubleshoot, and reset the Dockerized stack.
- [MONITORING.md](MONITORING.md) - metrics, structured logs, and collector integration.
- [PRODUCTION-HANDOFF.md](PRODUCTION-HANDOFF.md) - production deployment handoff and verified runtime notes.
- [docs/TRANSACTIONS.md](docs/TRANSACTIONS.md) - transaction data model notes.
- [docs/IMPROVEMENTS.md](docs/IMPROVEMENTS.md) - recent improvements and operational notes.
- [docs/db-commands.md](docs/db-commands.md) - useful database commands.
- [docs/db-danger-commands.md](docs/db-danger-commands.md) - destructive database commands; use with care.

## Notes

- `migrations` is a one-shot container. `Exited (0)` after startup is expected.
- `./run-indexer.sh debug` enables Kafka UI for inspection.
- Use `LOG_FORMAT=json` in production if logs are shipped to Loki or another structured log backend.
- Use `./run-indexer.sh reset` only when deleting indexed data is intended.

## License

[Apache-2.0](LICENSE)
