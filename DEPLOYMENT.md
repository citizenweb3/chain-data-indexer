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

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 16 GB | 32+ GB |
| Disk | 200 GB SSD | 500+ GB NVMe |
| Network | 100 Mbps | 1 Gbps |

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
# Start with external PostgreSQL access
docker compose -f docker-compose.yaml \
               -f docker-compose.override.yaml \
               -f docker-compose.prod.yaml \
               --env-file .env up --build -d

# Indexer logs only
docker compose logs -f indexer

# All logs
docker compose logs -f
```

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

2. Verify you're using `docker-compose.prod.yaml`:
   ```bash
   docker compose -f docker-compose.yaml \
                  -f docker-compose.override.yaml \
                  -f docker-compose.prod.yaml \
                  --env-file .env up -d
   ```

3. Check port mapping:
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
