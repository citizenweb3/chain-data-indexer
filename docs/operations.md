# Monero Indexer Operations

This guide covers env vars, local runs, Docker Compose, health, metrics, and
troubleshooting.

---

## Environment variables

Copy `.env.example` to `.env` and set at least `PG_PASSWORD`.

| Variable | Required | Default | Description |
|---|---:|---|---|
| `PG_PASSWORD` | yes | none | PostgreSQL password |
| `NODE_URL` | no | `http://localhost:18089` | Monero daemon RPC endpoint |
| `PG_HOST` | no | `localhost` | PostgreSQL host |
| `PG_PORT` | no | `5432` | PostgreSQL port |
| `PG_DB` | no | `monero_indexer` | PostgreSQL database |
| `PG_USER` | no | `monero` | PostgreSQL user |
| `PG_SSL` | no | `false` | Enable TLS for remote PostgreSQL |
| `FROM_HEIGHT` | no | `0` | First height when no saved progress exists |
| `FOLLOW` | no | `true` | Follow tip after backfill |
| `BATCH_SIZE` | no | `200` | Heights per backfill batch |
| `RPC_CONCURRENCY` | no | `16` | Concurrent `get_block` calls |
| `TX_BATCH_SIZE` | no | `200` | Transaction hashes per `/get_transactions` call |
| `FOLLOW_POLL_INTERVAL_MS` | no | `10000` | Tip poll interval |
| `SETTLEMENT_DEPTH` | no | `20` | Marks `is_settled` and supply safe-tip |
| `SUPPLY_ENABLED` | no | `true` | Enable supply subsystem |
| `SUPPLY_CHUNK_SIZE` | no | `25000` | Supply bootstrap chunk size |
| `SUPPLY_UPDATE_INTERVAL_MS` | no | `3600000` | Hourly supply refresh interval |
| `HEALTH_MAX_LAG_BLOCKS` | no | `50` | Lag threshold for degraded health |
| `HEALTH_MAX_STALL_MS` | no | `300000` | Progress-age threshold for degraded health |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, `error` |
| `LOG_FORMAT` | no | `pretty` | `pretty` or `json` |
| `API_PORT` | no | `3001` | HTTP port for API/health/metrics |
| `METRICS_ENABLED` | no | `true` | Expose `/metrics` |

---

## Local run

```bash
corepack enable
yarn install
cp .env.example .env
# edit .env
yarn db:init
yarn build
yarn start
```

Useful checks:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/metrics
curl http://localhost:3001/api/v1/stats
curl -s -X POST "$NODE_URL/json_rpc" \
  -H 'Content-Type: application/json' \
  -d '{"jsonrpc":"2.0","id":"0","method":"get_info"}'
```

---

## Docker Compose

```bash
cp .env.example .env
docker compose up -d --build
docker compose logs -f indexer
```

Compose starts:

| Port | Service |
|---|---|
| `5432` or `PG_HOST_PORT` | PostgreSQL |
| `3001` or `API_HOST_PORT` | API + health + metrics |

Default Compose `NODE_URL` is:

```env
NODE_URL=http://host.docker.internal:18089
```

This assumes monerod runs on the Docker host. Override it if the daemon lives on
another host or service.

---

## Health interpretation

`GET /health` is not just a process heartbeat. It should answer:

1. can the DB be reached,
2. can the node be reached,
3. is the node synced,
4. is the indexer making progress,
5. is the daemon pruned.

Typical degraded causes:

- node unreachable,
- node still syncing far behind tip,
- indexer lag above `HEALTH_MAX_LAG_BLOCKS`,
- no recent progress for longer than `HEALTH_MAX_STALL_MS`,
- supply enabled against a pruned node.

---

## Metrics

When `METRICS_ENABLED=true`, Prometheus metrics are exposed at `/metrics`.

Important series:

- `monero_indexed_height`
- `monero_chain_tip_height`
- `monero_lag_blocks`
- `monero_blocks_processed_total`
- `monero_block_process_duration_seconds`
- `monero_flush_duration_seconds`
- `monero_flush_rows_total`
- `monero_rpc_requests_total`
- `monero_rpc_request_duration_seconds`
- `monero_rpc_outage_state`
- `monero_supply_checkpoint_height`
- `monero_node_pruned`
- `monero_node_synchronized`

Keep labels bounded. Never add hash/address/tx-height labels.

---

## Structured logs

Set `LOG_FORMAT=json` for production. One line = one JSON object:

```json
{"ts":"2026-01-01T00:00:00.000Z","level":"info","label":"monero-indexer","message":"Indexer started","metadata":{}}
```

Do not log secrets or full raw RPC payloads at `info`.

---

## Troubleshooting

### `get_coinbase_tx_sum` is slow or hangs

Checks:

1. Run it locally against monerod, bypassing nginx.
2. Confirm the daemon is **not pruned**.
3. Test with a small chunk first.
4. Watch CPU, RAM, and disk IO during the request.

Expected fix pattern:

- chunked bootstrap in the indexer,
- archival node,
- hourly incremental append from last valid checkpoint,
- no giant full-range cron query.

### Node reachable but health is degraded

Likely causes:

- node still syncing (`target_height > height`),
- lag crossed `HEALTH_MAX_LAG_BLOCKS`,
- indexer stalled,
- DB unavailable.

### Supply endpoint stays empty

Likely causes:

- `SUPPLY_ENABLED=false`,
- node is pruned,
- node not synced enough to reach settled tip,
- no successful checkpoint bootstrap yet.
