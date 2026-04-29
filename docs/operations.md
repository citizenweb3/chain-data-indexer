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
| `PG_HOST_PORT` | no | `5432` | Host port published by Docker Compose for PostgreSQL. Does not change the internal container port. |
| `PG_DB` | no | `logos_indexer` | PostgreSQL database. |
| `PG_USER` | no | `logos` | PostgreSQL user. |
| `FROM_SLOT` | no | `0` | First slot used only when no saved progress exists. Saved progress takes precedence. |
| `FOLLOW` | no | `true` | When `true`, backfill then follow live blocks. When `false`, backfill then exit. |
| `BATCH_SIZE` | no | `500` | Slot range size per `/cryptarchia/blocks` request. Lower it if the node times out. |
| `LOG_LEVEL` | no | `info` | `debug`, `info`, `warn`, or `error`. |
| `API_PORT` | no | `3001` | Internal/container HTTP port for `/health` and `/api/v1/*`. |
| `API_HOST_PORT` | no | `3001` | Host port published by Docker Compose for the indexer API. |

`HEALTH_PORT` is accepted as a backward-compatible alias for `API_PORT`, but new
deployments should use `API_PORT`.

---

## Local run

```bash
npm install
cp .env.example .env
# edit .env and set PG_PASSWORD / NODE_URL
psql "$DATABASE_URL" -f initdb/001-schema.sql
npm run build
npm start
```

Useful checks:

```bash
curl http://localhost:8080/cryptarchia/info
curl http://localhost:3001/health
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

If local port `3001` is busy, set:

```env
API_HOST_PORT=13001
```

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

### SSE reconnect loop

Symptoms:

- Logs show `SSE stream error` or `SSE stall detected`.
- `/health` lag increases temporarily.

This is expected during node restarts or network flaps. On reconnect, the
indexer runs `syncFromProgress()` before subscribing again, so missed slots are
gap-filled from the saved progress slot.

If it persists:

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
- Run one active indexer per database unless a future leader-election mechanism is
  added. Multiple active indexers are mostly idempotent, but they add load and can
  race on progress.
- Monitor `/health`, indexer logs, PostgreSQL disk usage, and node sync mode.
