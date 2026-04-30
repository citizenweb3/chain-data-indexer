# Observability — Aztec Indexer

The Aztec indexer exposes Prometheus-format metrics and structured JSON logs.
Both services (`aztec-listener`, `explorer-api`) follow the same contract so a
single Grafana stack can dashboard them uniformly.

---

## Endpoints

| Service          | Container port | Host bind                 | Routes                |
|------------------|---------------:|---------------------------|-----------------------|
| `aztec-listener` | `8000`         | `127.0.0.1:8001` (lo only) | `/health`, `/metrics` |
| `explorer-api`   | `8000`         | `0.0.0.0:8000`             | `/health`, `/metrics`, `/v1/...` |

`/metrics` returns Prometheus text exposition (`text/plain; version=0.0.4`).
The listener metrics port is loopback-only by design — collectors run on the
host (Alloy / Prometheus) and reach it through `127.0.0.1`.

---

## Metric inventory

All metrics use the prefixes `aztec_listener_*` and `aztec_api_*`. Process
defaults from `prom-client` are also exported (`process_*`, `nodejs_*`).

### Common (both services)

| Metric                                  | Type | Labels         | Meaning |
|-----------------------------------------|------|----------------|---------|
| `*_uptime_seconds`                      | counter | —           | Seconds since process start |
| `*_pg_pool_total`                       | gauge | —           | Total pg connections in pool |
| `*_pg_pool_idle`                        | gauge | —           | Idle pg connections |
| `*_pg_pool_waiting`                     | gauge | —           | Clients waiting for a connection |

### `aztec_listener_*` (block ingestion)

| Metric                                            | Type | Labels                    | Meaning |
|---------------------------------------------------|------|---------------------------|---------|
| `aztec_listener_chain_proposed_tip_height`        | gauge | —                        | Latest sequencer-seen height observed via RPC |
| `aztec_listener_chain_proven_tip_height`          | gauge | —                        | Latest L1-proven height |
| `aztec_listener_indexed_proposed_height`          | gauge | —                        | Last persisted proposed-height watermark |
| `aztec_listener_indexed_proven_height`            | gauge | —                        | Last persisted proven-height watermark |
| `aztec_listener_lag_proposed_blocks`              | gauge | —                        | `chain_proposed_tip - indexed_proposed` |
| `aztec_listener_lag_proven_blocks`                | gauge | —                        | `chain_proven_tip - indexed_proven` |
| `aztec_listener_blocks_processed_total`           | counter | `status`               | `proposed` / `proven` / `catchup_proposed` / `catchup_proven` |
| `aztec_listener_block_process_duration_seconds`   | histogram | `status`             | End-to-end per-block processing time |
| `aztec_listener_block_fetch_duration_seconds`     | histogram | `cache`              | RPC fetch time, `cache=hit\|miss` |
| `aztec_listener_phase`                            | gauge | `phase`                  | One-hot: `catchup` / `live` |
| `aztec_listener_block_fetcher_queue_size`         | gauge | —                        | Pending fetches in worker pool |
| `aztec_listener_block_fetcher_active_workers`     | gauge | —                        | In-flight fetcher workers |
| `aztec_listener_block_fetcher_cache_size`         | gauge | —                        | Pre-fetched blocks cached |
| `aztec_listener_rpc_nodes_online`                 | gauge | —                        | Number of healthy RPC nodes in pool |
| `aztec_listener_rpc_requests_total`               | counter | `node`,`status`        | RPC outcomes: `ok` / `timeout` / `error` |
| `aztec_listener_rpc_request_duration_seconds`     | histogram | `node`               | RPC latency per node |
| `aztec_listener_flush_duration_seconds`           | histogram | `table`              | DB write batch duration; `table=heights` for batch-heights writer |
| `aztec_listener_flush_rows_total`                 | counter | `table`,`column`       | Rows written per flush column |
| `aztec_listener_message_bus_published_total`      | counter | `topic`,`status`       | Kafka publish outcomes |

### `aztec_api_*` (HTTP + consumer)

| Metric                                          | Type | Labels                 | Meaning |
|-------------------------------------------------|------|------------------------|---------|
| `aztec_api_http_requests_total`                 | counter | `route`,`method`,`status` | `status` = `2xx`/`3xx`/`4xx`/`5xx` (class only — keeps cardinality bounded) |
| `aztec_api_http_request_duration_seconds`       | histogram | `route`,`method`     | `route` is the matched Express route template, never the raw URL |
| `aztec_api_http_in_flight_requests`             | gauge | —                       | Concurrent in-flight requests |
| `aztec_api_message_bus_consumed_total`          | counter | `topic`,`status`      | Kafka consume outcomes |
| `aztec_api_message_bus_consume_duration_seconds`| histogram | `topic`              | Per-message processing time |

### Cardinality discipline

Allowed label keys: `module`, `level`, `route`, `method`, `status`, `phase`,
`table`, `column`, `topic`, `cache`, `node`. **Never** label by per-block /
per-tx values (`height`, `hash`, `address`, `block_id`, …) — they cause
unbounded label cardinality and break Prometheus.

---

## Structured logs

Logging format is controlled by `LOG_FORMAT`:

- `LOG_FORMAT=pretty` (default in dev) — colorized printf, human-friendly.
- `LOG_FORMAT=json` (default in compose) — newline-delimited JSON, ready for
  Loki ingestion.

JSON shape:

```json
{ "ts": "2025-01-15T10:23:45.123Z", "level": "info", "label": "block-poller",
  "message": "🐱 catchup proposed block 12345", "metadata": { } }
```

The field name `label` is part of the contract — host-level pipelines parse on
that key. Do not rename.

---

## Integration patterns

We do not bundle a Prometheus or Alloy container in `docker-compose.indexer.yml`.
Collectors run **on the host** and scrape both services over loopback. Two
example configurations are shipped under `docs/observability/`:

- [`docs/observability/alloy.river`](docs/observability/alloy.river) — Grafana
  Alloy config (recommended). Replaces `prometheus + node_exporter +
  promtail` with a single binary; remote-writes metrics and logs to a central
  Mimir + Loki stack.
- [`docs/observability/prometheus.yml`](docs/observability/prometheus.yml) —
  classic Prometheus scrape config for OSS users not on the Grafana stack.

Both files use **placeholder env vars** for endpoints / credentials — you fill
them in on the host (e.g. via systemd unit `Environment=` or the Alloy
`/etc/default/alloy` file). Real values must never be committed.

### Quick verification

```bash
# Listener: scraped by host-local Alloy/Prometheus
curl -sf http://127.0.0.1:8001/metrics | head

# Explorer API: publicly bound, also exposes /metrics
curl -sf http://127.0.0.1:8000/metrics | head

# JSON logs (after compose restart with LOG_FORMAT=json)
docker logs aztec-indexer-listener 2>&1 | head -3 | jq .
```

---

## Suggested PromQL starters

```promql
# Indexing lag (alert candidate when persistently > 50)
aztec_listener_lag_proposed_blocks
aztec_listener_lag_proven_blocks

# Throughput (blocks/s) over 5m, split by phase
sum by (status) (rate(aztec_listener_blocks_processed_total[5m]))

# RPC error ratio per node
sum by (node) (rate(aztec_listener_rpc_requests_total{status!="ok"}[5m]))
  / sum by (node) (rate(aztec_listener_rpc_requests_total[5m]))

# API p95 latency by route
histogram_quantile(0.95,
  sum by (le, route) (rate(aztec_api_http_request_duration_seconds_bucket[5m])))

# 5xx ratio
sum(rate(aztec_api_http_requests_total{status="5xx"}[5m]))
  / sum(rate(aztec_api_http_requests_total[5m]))
```

LogQL example:

```logql
{container="aztec-indexer-listener"} | json | level="error"
```

---

## Where things live in code

| Concern                          | File |
|----------------------------------|------|
| Shared metrics infra package     | `packages/metrics-server/src/index.ts` |
| Logger (JSON / pretty switch)    | `packages/logger-server/src/index.ts` |
| Listener metric registry         | `services/aztec-listener/src/metrics/registry.ts` |
| Listener sampler (5 s interval)  | `services/aztec-listener/src/metrics/sampler.ts` |
| API metric registry              | `services/explorer-api/src/metrics/registry.ts` |
| API HTTP middleware              | `services/explorer-api/src/metrics/http-middleware.ts` |
| `/metrics` mount (listener)      | `services/aztec-listener/src/health.ts` |
| `/metrics` mount (api)           | `services/explorer-api/src/svcs/http-server/express-config.ts` |
