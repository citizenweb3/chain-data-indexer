# Deployment Guide: Chain Data Indexer + ValidatorInfo Integration

## Table of Contents

- [Local Setup (Testing)](#local-setup-testing)
- [Production Deployment](#production-deployment)
- [ValidatorInfo Integration](#validatorinfo-integration)
- [Monitoring & Maintenance](#monitoring--maintenance)
- [Troubleshooting](#troubleshooting)

---

## Local Setup (Testing)

### Requirements

- Docker & Docker Compose v2+
- 8+ GB RAM (16+ GB recommended)
- 100+ GB free disk space (PostgreSQL + index data)

### Steps

```bash
# 1. Navigate to project directory
cd chain-data-indexer

# 2. Create .env from example
cp .env.example .env

# 3. (Optional) Change starting block for quick test
# Edit .env:
#   FIRST_BLOCK=28000000   # start from recent blocks

# 4. Start everything
docker compose --env-file .env up --build -d

# 5. Watch logs
docker compose logs -f indexer
docker compose logs -f db        # in another terminal
```

### Verify It's Working

```bash
# Container status
docker compose ps

# Connect to PostgreSQL
docker exec -it cosmosindexer psql -U cosmos_indexer_user -d cosmos_indexer_db

# Check indexing progress
SELECT * FROM core.indexer_progress;

# Check block count
SELECT COUNT(*) FROM core.blocks;

# Last 5 blocks
SELECT height, time, tx_count FROM core.blocks ORDER BY height DESC LIMIT 5;
```

### Shutdown

```bash
docker compose --env-file .env down

# Full reset (delete all data)
docker compose down -v
```

---

## Production Deployment

### Server Requirements

| Resource | Minimum    | Recommended  |
| -------- | ---------- | ------------ |
| CPU      | 4 cores    | 8+ cores     |
| RAM      | 16 GB      | 32+ GB       |
| Disk     | 200 GB SSD | 500+ GB NVMe |
| Network  | 100 Mbps   | 1 Gbps       |

### Deployment Steps

```bash
# 1. Clone to server
git clone https://github.com/citizenweb3/chain-data-indexer.git
cd chain-data-indexer

# 2. Create and configure .env
cp .env.example .env
nano .env
```

### Key `.env` Settings for Production

```env
# === RPC ===
RPC_URL=https://rpc.cosmoshub-4-archive.citizenweb3.com

# === Indexing ===
RESUME=true
FIRST_BLOCK=1                    # Starting block (or current for quick start)
FOLLOW=true                       # Follow new blocks
FOLLOW_INTERVAL_MS=5000

# === Performance ===
CONCURRENCY=48                    # Parallel requests (reduce for slow RPC)
RPS=500                           # Requests/sec (reduce if getting 429 errors)
TIMEOUT_MS=10000                  # Request timeout

# === PostgreSQL ===
PG_DB=cosmos_indexer_db
PG_USER=cosmos_indexer_user
PG_PASSWORD=<GENERATE_SECURE_PASSWORD>
PG_PORT=2432                      # External port
PG_VERSION=16                     # PostgreSQL version
PG_POOL_SIZE=16

# === Batch sizes (for fast indexing) ===
PG_BATCH_BLOCKS=1000
PG_BATCH_TXS=2000
PG_BATCH_MSGS=5000
PG_BATCH_EVENTS=10000

# === Memory ===
NODE_OPTIONS=--max-old-space-size=24576
```

### Start with Production Configuration

```bash
# Start (or rebuild) everything
docker compose --env-file .env up --build -d

# Indexer logs only
docker compose logs -f indexer

# All logs
docker compose logs -f
```

### Bulk Backfill Mode

Set `PG_BULK_MODE=true` in `.env` to drop secondary indexes during backfill and recreate them when done. This significantly improves ingestion throughput for large historical ranges.

```env
PG_BULK_MODE=true
RESUME=true
```

The indexer calls `bulkModeOn()` at startup (drops ~32 secondary indexes,
disables autovacuum on hot tables) and `bulkModeOff()` when the range is
complete (recreates indexes, runs VACUUM ANALYZE) before entering live follow
mode.

### Firewall Configuration

```bash
# Allow access only from ValidatorInfo server
sudo ufw allow from <VALIDATORINFO_SERVER_IP> to any port 2432

# Check rules
sudo ufw status numbered
```

---

## ValidatorInfo Integration

### Architecture

```
┌─────────────────────────────────────┐     ┌─────────────────────────────────────┐
│       Server: INDEXER               │     │       Server: VALIDATORINFO         │
│                                     │     │                                     │
│  ┌─────────────────────────────┐    │     │    ┌─────────────────────────────┐  │
│  │   cosmos-indexer-app        │    │     │    │     validatorinfo (dev)     │  │
│  │   (block indexing)          │    │     │    │     Backend + Frontend      │  │
│  └──────────────┬──────────────┘    │     │    └──────────────┬──────────────┘  │
│                 │ writes            │     │                   │ reads           │
│                 ▼                   │     │                   │                 │
│  ┌─────────────────────────────┐    │     │                   │                 │
│  │      PostgreSQL             │◄───┼─────┼───────────────────┘                 │
│  │   Port 2432 (external)      │    │     │                                     │
│  │   Schemas: core, bank,      │    │     │   TCP/IP connection                 │
│  │   stake, gov, ibc, wasm...  │    │     │   Secured by:                       │
│  └─────────────────────────────┘    │     │   - UFW firewall                    │
│                                     │     │   - Password auth                   │
└─────────────────────────────────────┘     │   - (Optional) SSL/VPN              │
                                            └─────────────────────────────────────┘
```

### Connection Options

#### Option A: Direct TCP Connection (Recommended)

**On ValidatorInfo server** add to environment:

```env
# Indexer database connection
INDEXER_DB_HOST=<INDEXER_SERVER_IP>
INDEXER_DB_PORT=2432
INDEXER_DB_USER=cosmos_indexer_user
INDEXER_DB_PASSWORD=<PASSWORD_FROM_INDEXER_ENV>
INDEXER_DB_NAME=cosmos_indexer_db
INDEXER_DB_SSL=false
```

**Connection string:**

```
postgresql://cosmos_indexer_user:<PASSWORD>@<INDEXER_IP>:2432/cosmos_indexer_db
```

#### Option B: VPN / Private Network

If both servers are in the same datacenter (Hetzner, DigitalOcean, AWS):

1. Create a private network between servers
2. PostgreSQL will be accessible via private IP (10.x.x.x)
3. No need to expose port to the internet

```env
# Example for private network
INDEXER_DB_HOST=10.0.0.5  # Private IP of indexer server
```

#### Option C: SSH Tunnel (for development)

```bash
# On ValidatorInfo server
ssh -L 5433:localhost:2432 user@indexer-server -N -f

# Now localhost:5433 -> indexer PostgreSQL
```

### Read-Only User (Recommended)

Create a separate user for ValidatorInfo with limited privileges:

```sql
-- Connect to indexer PostgreSQL
-- docker exec -it cosmosindexer psql -U cosmos_indexer_user -d cosmos_indexer_db

-- Create read-only user
CREATE USER validatorinfo_reader WITH PASSWORD '<SECURE_PASSWORD>';

-- Grant read access to all schemas
GRANT CONNECT ON DATABASE cosmos_indexer_db TO validatorinfo_reader;
GRANT USAGE ON SCHEMA core, bank, stake, gov, ibc, wasm, authz_feegrant, groups, tokens, analytics TO validatorinfo_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA core, bank, stake, gov, ibc, wasm, authz_feegrant, groups, tokens, analytics TO validatorinfo_reader;

-- Automatically grant privileges on future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA core GRANT SELECT ON TABLES TO validatorinfo_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA bank GRANT SELECT ON TABLES TO validatorinfo_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA stake GRANT SELECT ON TABLES TO validatorinfo_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA gov GRANT SELECT ON TABLES TO validatorinfo_reader;
-- ... repeat for other schemas
```

---

## Monitoring & Maintenance

### Health Endpoint (Level 1)

The indexer exposes a JSON health endpoint that checks real progress, not
just process aliveness — this is what catches silent stalls (frozen flush,
RPC outage, DB unresponsive) that previously went unnoticed.

```bash
# Check from the host (default port 3000, mapped via HEALTH_PORT)
curl -sS http://127.0.0.1:${HEALTH_PORT:-3000}/health

# Container-level health (driven by the same endpoint)
docker inspect cosmos-indexer-app --format '{{.State.Health.Status}}'
```

The endpoint returns HTTP 200 (`healthy`) or 503 (`degraded`) and a JSON
body with three checks:

- **db**: `SELECT last_height, updated_at FROM core.indexer_progress`
- **progress**: `now() - updated_at <= HEALTH_STALE_SECONDS` (default 180s)
- **rpc**: in-memory `rpcReachable` flag updated by `waitForRpcStatus()`

When `PG_BULK_MODE=true`, the indexer enters `phase: "maintenance"` after
backfill while `bulkModeOff()` restores LOGGED tables, secondary indexes,
autovacuum, and planner stats. During this expected pause the progress
freshness check is treated as OK because block height does not advance until
maintenance finishes. The `/health` body includes a `maintenance` section, and
logs emit `pg_stat_progress_create_index` snapshots for long `CREATE INDEX`
operations.

Tunables (in `.env`):

| Variable                       | Default     | Purpose                                                       |
| ------------------------------ | ----------- | ------------------------------------------------------------- |
| `HEALTH_PORT`                  | `3000`      | TCP port inside the container                                 |
| `HEALTH_EXTERNAL_HOST`         | `127.0.0.1` | Bind address on the host (set `0.0.0.0` to expose externally) |
| `HEALTH_STALE_SECONDS`         | `180`       | How long without progress before `degraded`                   |
| `HEALTH_STARTUP_GRACE_SECONDS` | `300`       | No 503 during cold start                                      |
| `HEALTH_ENABLED`               | `true`      | Set `false` to disable the server                             |

The compose file wires this into a Docker `healthcheck:` (interval 30s,
start_period 5m, retries 3). With `restart: unless-stopped`, a container
that returns 503 three times in a row is rebooted automatically.

### Prometheus Metrics (Level 2)

The same `HEALTH_PORT` also serves Prometheus text exposition at `/metrics`,
populated by [`prom-client`](https://github.com/siimon/prom-client). All
indexer-domain series are prefixed `cdi_*`; Node.js process defaults are
prefixed `cdi_node_*`.

```bash
curl -sS http://127.0.0.1:${HEALTH_PORT:-3000}/metrics | head
```

| Variable                     | Default | Notes                                                                    |
| ---------------------------- | ------- | ------------------------------------------------------------------------ |
| `METRICS_ENABLED`            | `true`  | Set `false` to disable the `/metrics` route and the sampler              |
| `METRICS_SAMPLE_INTERVAL_MS` | `5000`  | How often the sampler refreshes pg pool / decode pool / chain tip gauges |

Selected series (full list in `src/metrics/registry.ts`):

- `cdi_indexed_height`, `cdi_chain_tip_height`, `cdi_lag_blocks`
- `cdi_blocks_processed_total`, `cdi_block_process_duration_seconds`
- `cdi_flush_duration_seconds{group}`, `cdi_flush_rows_total{table}`
- `cdi_rpc_requests_total{endpoint,status}`, `cdi_rpc_request_duration_seconds{endpoint}`
- `cdi_rpc_outage_state` (1 while RPC is down)
- `cdi_decode_pool_busy`, `cdi_decode_pool_size`
- `cdi_pg_pool_active`, `cdi_pg_pool_idle`, `cdi_pg_pool_waiting`
- `cdi_bulk_mode`, `cdi_phase_info{phase}` (`starting`, `backfill`, `maintenance`, `follow`, `shutdown`)

> **Cardinality discipline**: never label series by `height`, `tx_hash`, or
> `validator_addr` — use only low-cardinality dimensions (`module`, `level`,
> `endpoint`, `group`, `table`, `phase`).

### Structured Logs (Level 4)

`LOG_FORMAT` controls the log encoder explicitly (no auto-detection):

| Value              | Meaning                                                                                               |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `pretty` (default) | Colorized printf, human-readable. Use locally.                                                        |
| `json`             | One JSON object per line: `{ts, level, label, message, metadata}`. Required for Loki / ELK ingestion. |

The shipped `docker-compose.yaml` defaults to `LOG_FORMAT=json` so production
containers emit machine-parseable lines out of the box.

### Observability Integration

The indexer exposes neutral interfaces (`/metrics` Prometheus text,
JSON stdout) so any standard collector can consume them. Two reference
configs live under `docs/observability/`:

#### (a) Grafana Alloy on the host (recommended)

`docs/observability/alloy.river` — single-binary collector that replaces
`prometheus + node_exporter + promtail` on the host. It scrapes:

- the indexer at `127.0.0.1:${HEALTH_PORT}/metrics`
- host metrics via `prometheus.exporter.unix` (drop-in node_exporter replacement)
- container stdout logs via `loki.source.docker` filtered to
  `cosmos-indexer-app`, with a JSON parsing stage extracting `level` and
  `label` (= module name from Winston's `getLogger(label)`)

Before starting Alloy on the host, export your central-stack credentials
(the config only references env vars — never hardcode URLs in the repo):

```bash
export PROM_REMOTE_WRITE_URL=...
export PROM_REMOTE_WRITE_USERNAME=...
export PROM_REMOTE_WRITE_PASSWORD=...
export LOKI_WRITE_URL=...
export LOKI_WRITE_USERNAME=...
export LOKI_WRITE_PASSWORD=...
```

Migration from existing `prometheus + node_exporter`:

```bash
# 1. Install Alloy (https://grafana.com/docs/alloy/latest/set-up/install/)
# 2. Copy the config
sudo cp docs/observability/alloy.river /etc/alloy/config.alloy
# 3. Start Alloy
sudo systemctl enable --now alloy
# 4. Verify scrape in central Grafana, then stop the legacy stack
sudo systemctl disable --now prometheus node_exporter
```

#### (b) Classic Prometheus + Promtail (for OSS users)

For sites that don't run the Grafana stack:

- `docs/observability/prometheus.yml` — minimal scrape config for the indexer
- `docs/observability/promtail-config.yml` — Docker SD + JSON pipeline equivalent

Note that Grafana Agent / Promtail are in maintenance mode upstream; new
deployments should prefer Alloy.

### Useful SQL Queries

```sql
-- Indexing progress
SELECT progress_id, last_height, updated_at
FROM core.indexer_progress;

-- Indexing speed (blocks in last hour)
SELECT COUNT(*) as blocks_last_hour
FROM core.blocks
WHERE time > NOW() - INTERVAL '1 hour';

-- Table sizes
SELECT
    schemaname || '.' || tablename as table,
    pg_size_pretty(pg_total_relation_size(schemaname || '.' || tablename)) as size
FROM pg_tables
WHERE schemaname IN ('core', 'bank', 'stake', 'gov')
ORDER BY pg_total_relation_size(schemaname || '.' || tablename) DESC
LIMIT 20;

-- Active partitions
SELECT
    parent.relname as parent,
    child.relname as partition
FROM pg_inherits
JOIN pg_class parent ON pg_inherits.inhparent = parent.oid
JOIN pg_class child ON pg_inherits.inhrelid = child.oid
WHERE parent.relname = 'blocks';
```

### Logs

```bash
# Indexer
docker compose logs -f indexer --tail 100

# PostgreSQL
docker compose logs -f db --tail 100

# Search for errors
docker compose logs indexer 2>&1 | grep -i error
```

### Restart

```bash
# Soft restart (preserves data)
docker compose --env-file .env restart indexer

# Full restart
docker compose --env-file .env down
docker compose --env-file .env up -d
```

---

## Troubleshooting

### Error: "rate limited" / 429

```env
# Reduce RPS in .env
RPS=100
CONCURRENCY=16
```

### Error: "out of memory"

```env
# Increase Node.js memory
NODE_OPTIONS=--max-old-space-size=32768

# Or reduce batch sizes
PG_BATCH_EVENTS=5000
PG_BATCH_ATTRS=15000
```

### Error: "partition does not exist"

Partitions are created automatically, but if error occurs:

```sql
-- Create partition manually (example for blocks 28M-29M)
SELECT util.ensure_next_height_partition('core', 'blocks');
```

### PostgreSQL Not Accepting External Connections

1. Check firewall:

   ```bash
   sudo ufw status
   ```

2. Check port mapping:
   ```bash
   docker port cosmosindexer
   # Should show: 5432/tcp -> 0.0.0.0:2432
   ```

### Slow Queries from ValidatorInfo

```sql
-- Check indexes exist
\d+ core.blocks
\d+ core.transactions

-- Analyze query
EXPLAIN ANALYZE SELECT * FROM core.blocks WHERE height > 27000000 LIMIT 10;

-- Update statistics
ANALYZE core.blocks;
ANALYZE core.transactions;
```

---

## Security Checklist

- [ ] Change PostgreSQL password from `password` to a secure one
- [ ] Configure UFW to restrict access to port 2432
- [ ] Create read-only user for ValidatorInfo
- [ ] (Optional) Enable SSL for PostgreSQL
- [ ] (Optional) Set up VPN between servers
- [ ] Regular backups: `pg_dump` or replication

---

## cosmos-indexer-api: Read-Only API Deployment

A separate service (`cosmos-indexer-api`, branch `cosmos-indexer-api`) exposes a
public Next.js HTTP API on top of this indexer's Postgres. It is sandboxed with
**four independent barriers** so that a compromised or buggy API cannot write
to or destroy the indexer database.

### Layout

```
/pool0/chain-data-indexer/   indexer worktree (main)
/pool0/cosmos-indexer-api/   API worktree (cosmos-indexer-api branch)
                             ├── docker-compose.override.yaml  (hardening)
                             ├── .env                          (secrets, mode 600)
                             └── .api-ro.password              (DB password, mode 600)
```

The API worktree is created with:

```bash
cd /pool0/chain-data-indexer
git worktree add /pool0/cosmos-indexer-api cosmos-indexer-api
```

### Four security barriers

1. **Database role** (`initdb/050-readonly-api-role.sql`)
   * `cosmos_api_ro` LOGIN, SELECT-only on all domain schemas.
   * `default_transaction_read_only=on` — even with broader grants, write
     transactions cannot be opened.
   * `statement_timeout=30s` — runaway queries cannot block autovacuum.
   * `idle_in_transaction_session_timeout=60s` — leaked transactions cannot
     block VACUUM.
   * `CONNECTION LIMIT 30` — bounded so an API leak cannot exhaust
     `max_connections=500` and lock out the indexer.
   * `ALTER DEFAULT PRIVILEGES` ensures new partitions are auto-granted SELECT.

2. **`pg_hba.conf` isolation** (top of file, **above** any `trust` rule)
   ```
   host    cosmos_indexer_db   cosmos_api_ro   172.26.0.0/16   scram-sha-256
   host    all                 cosmos_api_ro   all             reject
   ```
   The role can authenticate only from the `cosmos-indexer-net` docker subnet.
   From the host loopback, other docker networks, or external IPs → reject.

3. **Docker network isolation**
   * Shared external network `cosmos-indexer-net` connects only the indexer DB
     and the API container. The indexer service itself is not on this network.
   * API host port is bound to `127.0.0.1:3001` only — never exposed publicly;
     TLS termination lives on a separate nginx host (`192.168.5.12`).

4. **Container hardening** (`docker-compose.override.yaml`)
   * `read_only: true` + tmpfs for `/tmp` and `/app/.next/cache`
   * `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`
   * Runs as unprivileged `1001:1001`

### Initial bootstrap

```bash
# 1. Create the worktree
cd /pool0/chain-data-indexer
git worktree add /pool0/cosmos-indexer-api cosmos-indexer-api

# 2. Bootstrap the RO role (idempotent; safe to re-run for password rotation)
PG_PASSWORD=<from .env>
RO_PASSWORD=$(openssl rand -base64 48 | tr -d '/+=' | head -c 48)
docker cp initdb/050-readonly-api-role.sql cosmosindexer:/tmp/050.sql
docker exec -e PGPASSWORD="$PG_PASSWORD" cosmosindexer \
  psql -U cosmos_indexer_user -d cosmos_indexer_db -v ON_ERROR_STOP=1 \
       -v api_ro_password="$RO_PASSWORD" -f /tmp/050.sql
docker exec cosmosindexer rm /tmp/050.sql
printf '%s' "$RO_PASSWORD" | install -m 600 /dev/stdin /pool0/cosmos-indexer-api/.api-ro.password

# 3. Create the docker network (idempotent; ignore "already exists")
docker network create cosmos-indexer-net || true

# 4. Attach the running DB container to the network (no rebuild)
docker network connect cosmos-indexer-net cosmosindexer

# 5. Tighten pg_hba.conf — insert these two lines at the TOP of the active
#    rules (above any `trust` line). The role must only authenticate from the
#    cosmos-indexer-net subnet (default 172.26.0.0/16):
#
#      host    cosmos_indexer_db   cosmos_api_ro   172.26.0.0/16   scram-sha-256
#      host    all                 cosmos_api_ro   all             reject
#
#    Then reload:
docker exec -e PGPASSWORD="$PG_PASSWORD" cosmosindexer \
  psql -U cosmos_indexer_user -d cosmos_indexer_db -tAc 'SELECT pg_reload_conf();'

# 6. Build & start the API
cd /pool0/cosmos-indexer-api
# Create .env with COSMOS_INDEXER_API_KEY=<openssl rand -hex 32> and
# API_DB_PASSWORD=<contents of .api-ro.password>; chmod 600 .env
docker compose --env-file .env up -d --build
```

### Nginx (192.168.5.12) — TLS + proxy_pass

```nginx
server {
    listen 443 ssl http2;
    server_name indexer.cosmoshub-4.citizenweb3.com;

    ssl_certificate     /etc/letsencrypt/live/indexer.cosmoshub-4.citizenweb3.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/indexer.cosmoshub-4.citizenweb3.com/privkey.pem;

    server_tokens off;
    client_max_body_size 16k;

    location / {
        proxy_pass http://192.168.5.218:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}
```

(Both hosts are in `192.168.5.0/24`, so no tunnel is needed.)

### Verification (must all pass before going live)

```bash
RO_PASSWORD=$(cat /pool0/cosmos-indexer-api/.api-ro.password)
API_KEY=$(grep COSMOS_INDEXER_API_KEY /pool0/cosmos-indexer-api/.env | cut -d= -f2)

# A. API works from its own subnet
curl -s -H "x-api-key: $API_KEY" http://127.0.0.1:3001/api/v1/blocks?limit=1

# B. RO from host loopback → MUST be rejected
docker exec -e PGPASSWORD="$RO_PASSWORD" cosmosindexer \
  psql -U cosmos_api_ro -d cosmos_indexer_db -h 127.0.0.1 -c 'SELECT 1;'
# expected: pg_hba.conf rejects connection ...

# C. RO from a foreign docker network → MUST be rejected
docker run --rm --network chain-data-indexer_default \
  -e PGPASSWORD="$RO_PASSWORD" postgres:16 \
  psql -U cosmos_api_ro -d cosmos_indexer_db -h cosmosindexer -c 'SELECT 1;'
# expected: pg_hba.conf rejects connection ...

# D. Writes are impossible even from inside the allowed subnet
docker exec cosmos-indexer-api sh -c \
  'PGPASSWORD="$API_DB_PASSWORD" psql -U cosmos_api_ro -d cosmos_indexer_db \
    -h cosmosindexer -c "INSERT INTO core.blocks(height) VALUES(0);"' 2>&1 | tail -1
# expected: cannot execute INSERT in a read-only transaction

# E. statement_timeout fires after ~30s
docker exec -e PGPASSWORD="$RO_PASSWORD" cosmosindexer \
  psql -U cosmos_api_ro -d cosmos_indexer_db -h cosmosindexer -c 'SELECT pg_sleep(60);'
# expected: canceling statement due to statement timeout
```

### Operational runbook

* **Rotate `COSMOS_INDEXER_API_KEY`**: edit `.env`, then
  `docker compose --env-file .env up -d --force-recreate api`.
* **Rotate `cosmos_api_ro` password**: re-run step 2 of bootstrap with a new
  `RO_PASSWORD`, update `.env`, then `up -d --force-recreate api`.
* **Add a new schema/table**: re-run `050-readonly-api-role.sql` to refresh
  grants and default privileges.
* **Update API code**: `cd /pool0/cosmos-indexer-api && git pull && \
  docker compose --env-file .env up -d --build`.
* **Monitoring**: alert on `pg_hba.conf rejects connection ... cosmos_api_ro`
  in Postgres logs (someone is probing the read-only role from outside the
  allowed subnet).
* **Backup**: include `pg_dumpall --globals-only` in your regular backup so
  the role + per-role settings are restorable.
