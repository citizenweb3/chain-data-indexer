# Logos Indexer Operations

This guide covers local runs, Docker Compose, environment variables, health
checks, troubleshooting, and production deployment notes.

---

## Environment variables

Copy `.env.example` to `.env` and set at least `PG_PASSWORD`.

| Variable | Required | Default | Description |
|---|---:|---|---|
| `PG_PASSWORD` | yes | none | PostgreSQL password for the `logos` user. Empty or missing values fail config validation. |
| `NODE_URL` | no | `http://localhost:8080` | Logos node HTTP API endpoint. |
| `PG_HOST` | no | `localhost` | PostgreSQL host. Docker Compose sets this to `postgres`. |
| `PG_PORT` | no | `5432` | PostgreSQL port. |
| `PG_HOST_BIND` | no | `127.0.0.1` | Host bind address for Docker Compose PostgreSQL publishing. Keep localhost unless a firewall-restricted remote client requires access. |
| `PG_HOST_PORT` | no | `5432` | Host port published by Docker Compose for PostgreSQL. Does not change the internal container port. |
| `PG_DB` | no | `logos_indexer` | PostgreSQL database. |
| `PG_USER` | no | `logos` | PostgreSQL user. |
| `PG_SSL` | no | `false` | Enable TLS for remote PostgreSQL connections. |
| `PG_SSL_CA` | no | unset | Optional path to a CA certificate file used when `PG_SSL=true`. |
| `FROM_SLOT` | no | `0` | First slot used only when no saved progress exists. Saved progress takes precedence. |
| `FOLLOW` | no | `true` | When `true`, backfill then follow live blocks. When `false`, backfill then exit. |
| `BATCH_SIZE` | no | `500` | Slot range size per `/cryptarchia/blocks` request. Lower it if the node times out. |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, or `error`. |
| `LOG_FORMAT` | no | `pretty` | `pretty` for local terminals or `json` for one-object-per-line structured logs. Use `json` for log shipping. |
| `API_BIND` | no | `0.0.0.0` | Internal listener host for `/health`, `/metrics`, and `/api/v1/*`. |
| `API_PORT` | no | `3001` | Internal/container HTTP port for `/health` and `/api/v1/*`. |
| `API_HOST_BIND` | no | `0.0.0.0` | Host bind address for Docker Compose API publishing. Public deployments rely on nginx/API-token/firewall controls. |
| `API_HOST_PORT` | no | `3001` | Host port published by Docker Compose for the indexer API. |
| `METRICS_ENABLED` | no | `true` | Enables `GET /metrics`. Set `false` to return 404 for scrapes. |
| `METRICS_SAMPLE_INTERVAL_MS` | no | `5000` | Metrics sampler interval for node tip and PostgreSQL pool gauges. |

`HEALTH_PORT` is accepted as a backward-compatible alias for `API_PORT`, but new
deployments should use `API_PORT`.

---

## Local run

```bash
npm install
cp .env.example .env
# edit .env and set PG_PASSWORD / NODE_URL
npm run db:init
npm run build
npm start
```

Useful checks:

```bash
curl http://localhost:8080/cryptarchia/info
curl http://localhost:3001/health
curl http://localhost:3001/metrics
curl http://localhost:3001/api/v1/stats
```

---

## Docker Compose

```bash
cp .env.example .env
# edit .env: set PG_PASSWORD and NODE_URL if the node is not on the host
docker compose up -d --build
docker compose logs -f indexer
```

The Compose setup starts PostgreSQL and the indexer. It exposes:

| Port | Service |
|---|---|
| `5432` or `PG_HOST_PORT` | PostgreSQL |
| `3001` or `API_HOST_PORT` | Indexer API + health |

If local PostgreSQL already uses port `5432`, set:

```env
PG_HOST_PORT=15432
```

PostgreSQL is bound to `127.0.0.1` by default. Do not expose it on `0.0.0.0`
unless access is also restricted with UFW/security-group rules.
If `PG_HOST` points at a remote database, set `PG_SSL=true`; set `PG_SSL_CA`
when the remote PostgreSQL certificate is signed by a private CA.

If local port `3001` is busy, set:

```env
API_HOST_PORT=13001
```

The indexer HTTP API is public by default (`API_BIND=0.0.0.0` and
`API_HOST_BIND=0.0.0.0`) because fleet deployments are served through external
domains. Protect public access with nginx API-token rules and host firewall
allow-lists; do not expose it directly without that outer layer.

### Docker networking

Default Compose config uses:

```env
NODE_URL=http://host.docker.internal:8080
```

This targets a Logos node running on the Docker host. The Compose file includes
`extra_hosts: host.docker.internal:host-gateway`, which makes this work on
modern Linux Docker as well as Docker Desktop.

If the Logos node runs elsewhere, set:

```env
NODE_URL=http://your-node-host:8080
```

For production/Kubernetes, point `NODE_URL` at an internal service name or load
balanced node endpoint.

### Docker image

`Dockerfile` uses a multi-stage build:

1. Builder stage: Node 20 Alpine, installs dev dependencies, runs `npm run build`.
2. Runtime stage: Node 20 Alpine, installs production dependencies only, copies
   `dist/`, starts `node dist/index.js`.

Use `docker build -t logos-indexer .` for image-only validation.

---

## Health interpretation

```bash
curl http://localhost:3001/health
```

| Field | Normal | Investigate |
|---|---|---|
| `status` | `ok` | `degraded` or `error` |
| `node_mode` | `Online` | `Bootstrapping` for a long time |
| `lag_slots` | Small and decreasing | Sustained growth means node/indexer lag |
| `node_tip_slot` | non-null | `null` means the node is unreachable |
| `uptime_s` | increasing | Frequent low values mean restart loop |

Suggested alerting:

- `status != ok` for more than a few minutes.
- `lag_slots > 60` for more than a few minutes.
- `node_mode = Bootstrapping` for longer than expected initial sync.

---


## Prometheus Metrics

When `METRICS_ENABLED=true`, the HTTP server exposes Prometheus metrics on the
same port as the explorer API:

```bash
curl http://localhost:3001/metrics
```

Domain metrics use the `logos_` prefix. Node.js runtime metrics collected by
`prom-client` use the `logos_node_` prefix and are registered in an isolated
registry, not the global `prom-client` registry.

Key series:

- `logos_indexed_height`
- `logos_chain_tip_height`
- `logos_lag_blocks`
- `logos_blocks_processed_total`
- `logos_block_process_duration_seconds`
- `logos_flush_duration_seconds{group}`
- `logos_flush_rows_total{table}`
- `logos_rpc_requests_total{endpoint,status}`
- `logos_rpc_request_duration_seconds{endpoint}`
- `logos_rpc_outage_state`
- `logos_pg_pool_active`, `logos_pg_pool_idle`, `logos_pg_pool_waiting`
- `logos_phase_info{phase}`

`logos_lag_blocks` is derived from sampled chain tip height minus indexed height.
It stays `0` until the node tip has been sampled. Indexed height is updated only
from real or deterministically derived Logos block heights; when v0.1.2 omits
height on `/cryptarchia/blocks`, the indexer reconstructs it from tip/LIB
anchors plus the stored `parent_block` chain, and never substitutes slot values.

### Cardinality discipline

Do not add metric labels for slot, height, block hash, leader key, account,
address, transaction hash, or other unbounded values. Allowed domain metric
labels are only `module`, `level`, `endpoint`, `group`, `table`, `phase`, and
`status`; current metrics use `endpoint`, `group`, `table`, `phase`, and
`status`.

---

## Structured Logs

`LOG_FORMAT=pretty` keeps the local human-readable Winston output. Set
`LOG_FORMAT=json` for production log shipping. JSON mode emits exactly one JSON
object per line:

```json
{"ts":"2025-01-01T00:00:00.000Z","level":"info","label":"logos-indexer","message":"Database connected","metadata":{}}
```

The top-level `label` field is always present. If a log call supplies a `label`
metadata field it is used; otherwise the default is `logos-indexer`. Error
objects in metadata are serialized with name, message, and stack.

---

## Observability Integration

Reference configs live in [`docs/observability/`](observability/):

- `alloy.river` — recommended Grafana Alloy configuration for metrics and logs.
- `prometheus.yml` — classic Prometheus scrape alternative.
- `promtail-config.yml` — compatibility example only; Promtail is in maintenance
  mode, prefer Alloy for new deployments.

All example configs use environment placeholders only. Provide real remote-write,
Loki, and file path values through your deployment system; do not commit
credentials or tenant URLs.

---
## Troubleshooting

### Node unreachable

Symptoms:

- `/health` returns `status=degraded`.
- Logs show retry/backoff around `/cryptarchia/info`.

Checks:

```bash
curl "$NODE_URL/cryptarchia/info"
curl "$NODE_URL/network/info"
```

Fixes:

- Verify `NODE_URL`.
- Check firewall/container networking.
- In Docker Compose, verify `host.docker.internal` resolves or set a concrete host/IP.

### Database connection errors

Symptoms:

- Startup fails during `SELECT 1`.
- Logs show PostgreSQL authentication or connection errors.

Checks:

```bash
psql "postgresql://$PG_USER:$PG_PASSWORD@$PG_HOST:$PG_PORT/$PG_DB" -c 'SELECT 1'
psql "postgresql://$PG_USER:$PG_PASSWORD@$PG_HOST:$PG_PORT/$PG_DB" -c 'SELECT * FROM logos_indexer_progress'
```

Fixes:

- Verify `PG_PASSWORD`, `PG_HOST`, `PG_DB`, and schema initialization.
- Re-run schema init only against the intended database:
  `psql "$DATABASE_URL" -f initdb/001-schema.sql`.

### Progress starts from the wrong slot

`FROM_SLOT` is only used when there is no saved progress row. Existing progress
always wins to make restarts safe.

Inspect progress:

```sql
SELECT * FROM logos_indexer_progress;
```

Reset progress for a testnet restart or intentional re-index:

```sql
UPDATE logos_indexer_progress
SET last_slot = 0, last_height = NULL, updated_at = now()
WHERE id = 'default';
```

If you need a full rebuild, truncate indexed data and reset progress together:

```sql
TRUNCATE logos_blocks, logos_leaders RESTART IDENTITY CASCADE;
UPDATE logos_indexer_progress
SET last_slot = 0, last_height = NULL, updated_at = now()
WHERE id = 'default';
```

### Block-stream reconnect loop

Symptoms:

- Logs show `Block stream error` or `Block stream stall detected`.
- `/health` lag increases temporarily.

`Block stream closed` at `info` level is normal for the current Logos node: the
NDJSON endpoint may close a streaming HTTP connection after one or more events.
The indexer reconnects with a short delay and runs `syncFromProgress()` before
subscribing again, so missed slots are gap-filled from the saved progress slot.
`Block stream error` and `Block stream stall detected` are warnings and indicate
node restarts, network flaps, or a genuinely unhealthy stream.

If it persists:

- Verify `/cryptarchia/events/blocks/stream` is parsed as NDJSON
  (`application/x-ndjson`), not Server-Sent Events.

- Verify the node is `Online`.
- Lower `BATCH_SIZE` if catch-up requests time out.
- Check PostgreSQL latency and disk pressure.

### API port already in use

Set a different port:

```env
API_HOST_PORT=3010
```

In Docker Compose, update `.env` before `docker compose up -d`.

---

## Production deployment notes

- Put PostgreSQL data on persistent storage.
- Back up PostgreSQL regularly (`pg_dump` or provider-native backups).
- Expose the indexer API through a reverse proxy for TLS/auth if it is public.
- Keep the Logos node API private; the node endpoints are unauthenticated.
- Keep PostgreSQL local/private; if a remote PostgreSQL endpoint is required,
  enable `PG_SSL=true`.
- Run one active indexer per database unless a future leader-election mechanism is
  added. Multiple active indexers are mostly idempotent, but they add load and can
  race on progress.
- Monitor `/health`, `/metrics`, indexer logs, PostgreSQL disk usage, and node sync mode.
- Use `LOG_FORMAT=json` when shipping logs to Loki, Elasticsearch, or another centralized log system.
