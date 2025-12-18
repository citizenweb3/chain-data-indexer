# Aztec Blockchain Indexer

High-performance blockchain indexer for Aztec Protocol with REST API access.

**Performance:** 270-280 blocks/second with parallel processing and intelligent caching.

## 🚀 Quick Start

### Prerequisites

- Docker & Docker Compose
- 4+ CPU cores recommended
- 4GB+ RAM recommended

### Run Indexer

```bash
# 1. Configure environment (optional)
cp .env.indexer.example .env.indexer
nano .env.indexer  # Set your Aztec RPC URL

# 2. Start all services
docker-compose -f docker-compose.indexer.yml up -d

# 3. Check indexer logs
docker logs aztec-indexer-listener -f

# 4. Check API
curl http://localhost:8000/health
curl -H "X-API-Key: dev-api-key" http://localhost:8000/l2/latest-height
```

## 📊 Architecture

### Services

1. **aztec-listener** - Indexes Aztec L2 blocks and transactions
   - 30 parallel workers for block fetching
   - LRU cache (100 blocks)
   - Batch DB writes (every 300 blocks or 3 seconds)
   - Publishes events to Kafka

2. **explorer-api** - REST API for indexed data
   - Blocks, transactions, contracts
   - Search and statistics
   - OpenAPI documentation at `/l2/index`

3. **postgres** - Data storage (2 databases: aztec_listener, explorer_api)
4. **kafka** - Event streaming between services
5. **migrations** - Automatic database schema setup

### Ports

- `8000` - Explorer API
- `5439` - PostgreSQL (external, internal: 5432)
- `9092` - Kafka (internal only)

## ⚙️ Configuration

### Environment Variables

Key variables in `.env.indexer`:

```bash
# Required
AZTEC_RPC_URLS=mainnet::https://your-rpc-url.com

# Optional (with defaults)
POSTGRES_USER=aztec_indexer
POSTGRES_PASSWORD=aztec_indexer_secure_pass_2024
POSTGRES_PORT=5439

# Performance tuning
BLOCK_FETCHER_WORKERS=30        # Parallel RPC workers
BLOCK_PREFETCH_SIZE=30          # Prefetch buffer
BATCH_HEIGHTS_FLUSH_EVERY_N_BLOCKS=300
RPC_RATE_LIMIT_RPS=500          # Requests per second
RPC_RATE_LIMIT_MAX_CONCURRENT=100
```

### Database Credentials

**Default credentials** (change in production):
- User: `aztec_indexer`
- Password: `aztec_indexer_secure_pass_2024`
- Port: `5439` (external)

### API Authentication

Default API key: `dev-api-key`

Set custom keys via `API_KEYS` environment variable (comma-separated).

## 🔧 Development

### Build from source

```bash
# Install dependencies
yarn install

# Build packages
yarn build:packages

# Build services
cd services/aztec-listener && yarn build
cd ../explorer-api && yarn build
```

### Run tests

```bash
yarn test
```

### Lint

```bash
yarn lint
```

## 📡 API Endpoints

Base URL: `http://localhost:8000`

**Authentication:** Add header `X-API-Key: dev-api-key`

### Examples

```bash
# Get latest block height
curl -H "X-API-Key: dev-api-key" http://localhost:8000/l2/latest-height

# Get latest block
curl -H "X-API-Key: dev-api-key" http://localhost:8000/l2/blocks/latest

# Get specific block
curl -H "X-API-Key: dev-api-key" http://localhost:8000/l2/blocks/28653

# Search
curl -H "X-API-Key: dev-api-key" "http://localhost:8000/l2/search?query=0x..."

# Get contract instances
curl -H "X-API-Key: dev-api-key" http://localhost:8000/l2/contract-instances

# Get chain info
curl -H "X-API-Key: dev-api-key" http://localhost:8000/l2/info
```

### Full API Documentation

Browse interactive API docs: `http://localhost:8000/l2/index`

## 🐳 Docker Management

### Stop services

```bash
docker-compose -f docker-compose.indexer.yml down
```

### Restart with clean state

```bash
docker-compose -f docker-compose.indexer.yml down -v
docker-compose -f docker-compose.indexer.yml up -d
```

### View logs

```bash
# All services
docker-compose -f docker-compose.indexer.yml logs -f

# Specific service
docker logs aztec-indexer-listener -f
docker logs aztec-indexer-api -f
```

### Rebuild after code changes

```bash
docker-compose -f docker-compose.indexer.yml up --build -d
```

## 📈 Performance Monitoring

### Indexer Metrics

```bash
# Watch indexing speed
docker logs aztec-indexer-listener 2>&1 | grep "blocks/s"

# Example output:
# ⚡ 278.60 blocks/s | Queue: 0 | Workers: 29 | Cache: 29
```

### Health Checks

```bash
# API health
curl http://localhost:8000/health

# Prometheus metrics
curl http://localhost:8000/metrics
```

## 🗄️ Database Access

### Connect to PostgreSQL

```bash
docker exec -it aztec-indexer-postgres psql -U aztec_indexer -d aztec_listener

# Or from host (if port 5439 is exposed)
psql -h localhost -p 5439 -U aztec_indexer -d aztec_listener
```

### Backup database

```bash
docker exec aztec-indexer-postgres pg_dump -U aztec_indexer aztec_listener > backup.sql
```

### Restore database

```bash
cat backup.sql | docker exec -i aztec-indexer-postgres psql -U aztec_indexer aztec_listener
```

## 🔍 Troubleshooting

### Indexer not starting

```bash
# Check logs
docker logs aztec-indexer-listener

# Common issues:
# 1. RPC URL not set - check .env.indexer
# 2. Database not ready - wait for healthcheck
# 3. Port conflicts - change POSTGRES_PORT in .env.indexer
```

### Slow indexing

```bash
# Check worker utilization
docker logs aztec-indexer-listener | grep "Workers:"

# If workers < 25, check:
# 1. RPC node performance
# 2. Network latency
# 3. CPU/RAM availability
```

### API errors

```bash
# Check API logs
docker logs aztec-indexer-api

# Verify database connection
docker exec aztec-indexer-api node -e "console.log(process.env.POSTGRES_IP)"
```

## 📚 Project Structure

```
.
├── docker/
│   ├── universal.Dockerfile       # Multi-stage build for all services
│   ├── init-databases.sql         # Database initialization
│   └── run-migrations-docker.sh   # Migration script
├── packages/                      # Shared libraries
│   ├── backend-utils/
│   ├── logger-server/
│   ├── message-bus/
│   ├── postgres-helper/
│   └── types/
├── services/
│   ├── aztec-listener/           # Blockchain indexer
│   └── explorer-api/             # REST API
├── docs/                         # Additional documentation
├── docker-compose.indexer.yml    # Main deployment file
└── .env.indexer.example          # Configuration template
```

## 🛡️ Security

### Production Deployment

1. **Change default credentials:**
   ```bash
   POSTGRES_USER=your_secure_username
   POSTGRES_PASSWORD=your_strong_password_here
   API_KEYS=your_secure_api_key_1,your_secure_api_key_2
   ```

2. **Use environment files:**
   ```bash
   # Never commit .env.indexer to git
   echo ".env.indexer" >> .gitignore
   ```

3. **Restrict network access:**
   - Don't expose PostgreSQL port externally in production
   - Use reverse proxy (nginx) for API
   - Enable HTTPS/TLS

4. **Resource limits:**
   - Docker Compose already includes CPU/RAM limits
   - Adjust based on your server capacity

## 📖 Additional Documentation

- [AGENTS.md](AGENTS.md) - AI agents development guide
- [INDEXER.md](INDEXER.md) - Detailed indexer architecture
- [MONITORING.md](MONITORING.md) - Monitoring and observability
- [docs/](docs/) - Database commands and improvements

## 📄 License

Apache-2.0

## 🤝 Contributing

This is a specialized indexer for Aztec Protocol. For contributions, please ensure:
- TypeScript strict mode compliance
- No default exports (named exports only)
- ESLint and Prettier formatting
- Tests for new features

## 🔗 Links

- Aztec Protocol: https://aztec.network
- Original Explorer: https://aztecscan.xyz
