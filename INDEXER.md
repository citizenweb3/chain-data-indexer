# Aztec Blockchain Indexer

Aztec L2 blockchain indexer. Everything runs in Docker - one command to start.

## Requirements

- Docker and Docker Compose
- Access to an Aztec RPC node

## Quick Start

### 1. Create Configuration

```bash
cp .env.indexer.example .env.indexer
```

Edit `.env.indexer`:

```bash
# Your Aztec RPC (REQUIRED)
# Format: name::url (multiple nodes separated by comma)
AZTEC_RPC_URLS=my-node::http://YOUR_AZTEC_RPC:8080

# API key (any string you want)
API_KEYS=dev

# Network (MAINNET, TESTNET, DEVNET, SANDBOX)
L2_NETWORK_ID=MAINNET
```

### 2. Start

```bash
./run-indexer.sh start
```

First run will take a few minutes (building Docker images).

### 3. Verify

```bash
# Container status
./run-indexer.sh status

# Logs
./run-indexer.sh logs

# Test API
curl http://localhost:8000/l2/blocks?limit=5
```

## Commands

| Command                          | Description         |
| -------------------------------- | ------------------- |
| `./run-indexer.sh start`         | Start the indexer   |
| `./run-indexer.sh stop`          | Stop                |
| `./run-indexer.sh restart`       | Restart             |
| `./run-indexer.sh status`        | Container status    |
| `./run-indexer.sh logs`          | All logs            |
| `./run-indexer.sh logs listener` | Indexer logs        |
| `./run-indexer.sh logs api`      | API logs            |
| `./run-indexer.sh reset`         | Delete all data     |
| `./run-indexer.sh debug`         | Start with Kafka UI |

## API

Base URL: `http://localhost:8000/l2/`

### Available Endpoints Overview

```bash
# HTML page with all available routes
curl http://localhost:8000/l2/index
```

### Blocks

```bash
# Latest height
curl http://localhost:8000/l2/latest-height

# Latest block
curl http://localhost:8000/l2/blocks/latest

# List of blocks (with pagination)
curl http://localhost:8000/l2/blocks?from=0&limit=10

# Block by height
curl http://localhost:8000/l2/blocks/123

# Block by hash
curl http://localhost:8000/l2/blocks/0x...
```

### Contracts

```bash
# Contract classes
curl http://localhost:8000/l2/contract-classes

# Contract instances
curl http://localhost:8000/l2/contract-instances

# Specific contract instance
curl http://localhost:8000/l2/contract-instances/0x...
```

### Network Information

```bash
# L2 network information
curl http://localhost:8000/l2/info

# Network errors
curl http://localhost:8000/l2/errors
```

### Search

```bash
# Search by hash/height/address
curl http://localhost:8000/l2/search?q=123
curl http://localhost:8000/l2/search?q=0x...
```

### Transactions (TX Effects)

In Aztec, transactions are called "tx effects". Each tx-effect contains transaction execution results.

```bash
# All transactions with pagination
curl "http://localhost:8000/l2/tx-effects?limit=10&from=0"

# All transactions in a specific block
curl "http://localhost:8000/l2/blocks/123/tx-effects"

# Specific transaction by index in block (0, 1, 2...)
curl "http://localhost:8000/l2/blocks/123/tx-effects/0"

# Transaction by hash
curl "http://localhost:8000/l2/tx-effects/0x..."
```

#### Pending Transactions (mempool)

```bash
# Transactions waiting to be included in a block
curl "http://localhost:8000/l2/txs?limit=10"

# Specific pending transaction
curl "http://localhost:8000/l2/txs/0x..."

# Dropped transactions
curl "http://localhost:8000/l2/dropped-txs/0x..."
```

#### TX Effect Structure

Each transaction contains:

- `hash` - transaction hash
- `blockHeight` - block height
- `index` - index in block
- `revertCode` - revert code (0 = success)
- `transactionFee` - fee
- `noteHashes` - note hashes
- `nullifiers` - nullifiers
- `l2ToL1Msgs` - L2→L1 messages
- `publicLogs` - public logs
- `privateLogs` - private logs (encrypted)
- `contractClassLogs` - contract class logs

### Transaction Logs

Logs are included in tx-effect. To search by public logs:

```bash
# Search transactions by value in public logs
# frLogEntry - Field element in hex (e.g. 0x1234...)
# index - position in log array (0, 1, 2...)
curl "http://localhost:8000/l2/search/public-logs?frLogEntry=0x1234567890abcdef&index=0"

# Example: search where first log position (index=0) has specific value
curl "http://localhost:8000/l2/search/public-logs?frLogEntry=0x0000000000000000000000000000000000000000000000000000000000000005&index=0"
```

Public logs in tx-effect are arrays of Fr value arrays:

```json
{
  "publicLogs": [
    ["0x1234...", "0x5678...", "0x9abc..."],
    ["0xdef0...", "0x1111..."]
  ]
}
```

### Statistics

```bash
# Total number of transactions
curl http://localhost:8000/l2/stats/total-tx-effects

# Transactions in last 24 hours
curl http://localhost:8000/l2/stats/tx-effects-last-24h

# Total number of contracts
curl http://localhost:8000/l2/stats/total-contracts

# Contracts in last 24 hours
curl http://localhost:8000/l2/stats/total-contracts-last-24h

# Average fees
curl http://localhost:8000/l2/stats/average-fees

# Average block time
curl http://localhost:8000/l2/stats/average-block-time
```

## Configuration

### Required Parameters

```bash
# Your Aztec RPC (format: name::url)
AZTEC_RPC_URLS=my-node::http://YOUR_RPC:8080

# For multiple nodes (failover):
# AZTEC_RPC_URLS=primary::https://rpc1.example.com,backup::https://rpc2.example.com

# Network
L2_NETWORK_ID=MAINNET
```

### Optional Parameters

```bash
# Speed up synchronization
CATCHUP_POLL_WAIT_TIME_MS=50

# Disable pending tx tracking
AZTEC_LISTEN_FOR_PENDING_TXS=false

# Change API port
API_PORT=3000
```

**Start from specific block** (skip history):

To start indexing from a specific block, add variables to docker-compose.indexer.yml in the `aztec-listener` -> `environment` section:

```yaml
# In docker-compose.indexer.yml, in aztec-listener -> environment section:
AZTEC_LISTEN_FOR_PROPOSED_BLOCKS_FORCED_START_FROM_HEIGHT: 1000
AZTEC_LISTEN_FOR_PROVEN_BLOCKS_FORCED_START_FROM_HEIGHT: 1000
```

## Architecture

```
┌─────────────────┐     ┌─────────┐     ┌──────────────┐
│  Aztec RPC      │────▶│  Kafka  │────▶│  PostgreSQL  │
│  (your node)    │     │         │     │              │
└─────────────────┘     └─────────┘     └──────────────┘
                              │                │
                              ▼                ▼
                        ┌───────────────────────────┐
                        │       Explorer API        │
                        │   http://localhost:8000   │
                        └───────────────────────────┘
```

**Containers:**

- `postgres` - database
- `zookeeper` + `kafka` - message queue
- `migrations` - applies DB migrations (runs once)
- `aztec-listener` - indexes blocks from your RPC
- `explorer-api` - REST API

## Direct Database Access

```bash
# Connect to PostgreSQL
docker exec -it aztec-indexer-postgres psql -U chicmoz -d explorer_api

# Queries
SELECT height, hash, timestamp FROM l2_blocks ORDER BY height DESC LIMIT 10;
SELECT COUNT(*) FROM l2_blocks;
SELECT COUNT(*) FROM contract_instances;
```

## Monitoring

### Synchronization Progress

```bash
./run-indexer.sh logs listener
```

In logs you'll see:

```
🐱 ==== poller state ====
Proposed height PROCESSED 1234 | CHAIN 5000 | DIFF 3766
```

`DIFF` = how many blocks left to synchronize.

### Kafka UI (for debugging)

```bash
./run-indexer.sh debug
# Open http://localhost:8081
```

## Troubleshooting

### Container won't start

```bash
# Check logs
docker-compose -f docker-compose.indexer.yml logs migrations
docker-compose -f docker-compose.indexer.yml logs aztec-listener
```

### API not responding

```bash
# Check that containers are running
./run-indexer.sh status

# Check API logs
./run-indexer.sh logs api
```

### Reset everything and start fresh

```bash
./run-indexer.sh reset
./run-indexer.sh start
```

## File Structure

```
├── .env.indexer.example     # Example configuration
├── .env.indexer             # Your configuration
├── docker-compose.indexer.yml
├── docker/
│   ├── aztec-listener.Dockerfile
│   ├── explorer-api.Dockerfile
│   ├── migrations.Dockerfile
│   ├── init-databases.sql
│   └── run-migrations-docker.sh
├── run-indexer.sh           # Management script
└── INDEXER.md               # This documentation
```
