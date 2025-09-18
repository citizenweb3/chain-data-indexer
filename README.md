# Indexer Monorepository

## 📚 Repository Overview

**Indexer Monorepository** is a hub for high-performance blockchain data indexers tailored for various blockchain networks. Each indexer is maintained in a separate branch, allowing for network-specific configurations and optimizations while sharing a common codebase foundation. This structure enables efficient development, maintenance, and deployment of indexers for different blockchain networks (e.g., `cosmos`, `ethereum`, `polkadot`, etc.).

### 🌌 About the Indexers

Each indexer in this monorepository is designed to extract, process, and store blockchain data from a specific network into a PostgreSQL database, enabling fast queries and comprehensive data analysis. Navigate to the appropriate branch for the network you want to index.

## Cosmos Indexer

### 🌌 Project Description

**Cosmos Indexer** is a high-performance blockchain data indexer specifically designed for the Cosmos ecosystem. Our solution efficiently extracts, processes, and stores blockchain data from Cosmos-based networks into a PostgreSQL database, enabling fast queries and comprehensive data analysis.

### ✨ Key Features

- 🚀 **High Performance**: Built with TypeScript and optimized for handling large volumes of blockchain data.
- 🔄 **Resume Capability**: Smart resumption from the last indexed block, preventing data loss during restarts.
- 🐳 **Docker Ready**: Fully containerized with Docker Compose for easy deployment and scaling.
- 🗄️ **PostgreSQL Integration**: Robust data storage with automatic table partitioning and indexing.
- 📊 **Message Decoding**: Advanced message type detection and decoding capabilities for blockchain transactions.
- ⚡ **Real-time Processing**: Efficient block-by-block processing with configurable concurrency limits.

### 🏗️ Architecture

- **RPC Client**: Connects to blockchain RPC endpoints using appropriate libraries for each network.
- **Message Decoder**: Dynamically generates and uses message type definitions specific to each blockchain.
- **Database Layer**: Optimized PostgreSQL schema with automatic partitioning.
- **Configuration System**: Flexible environment-based configuration with validation.

### 🎯 Use Cases

- **Analytics Platforms**: Power blockchain analytics dashboards and reports.
- **DeFi Applications**: Track transactions, token transfers, and protocol interactions.
- **Compliance & Auditing**: Maintain comprehensive transaction records for regulatory compliance.
- **Research & Development**: Enable blockchain research with structured, queryable data.
- **Block Explorers**: Provide fast data access for blockchain exploration tools.

## Requirements

- Node.js
- npm
- yarn
- Docker && docker-compose

## Running with Docker

1. Create `.env` with required variables (PG_*, RPC_URL, NODE_OPTIONS if needed).

```bash
cp .env.example .env
```

2. Build and start all services:

```bash
docker compose --env-file .env up --build -d
```

3. View indexer logs:

```bash
docker compose logs -f indexer
```

Notes:
- The indexer container defaults to `SINK=postgres` and `RESUME=true` so it will try to resume from last saved progress when restarted.
- To force a fresh DB init, remove the Postgres volume from the host and bring the DB up again:

```bash
docker compose down -v
docker compose --env-file .env up -d db
```

Behavior details:
- On first start (fresh Postgres volume) the `initdb/*.sql` scripts are executed by the Postgres image. The indexer waits for Postgres to be healthy and checks for the `progress` table; if missing it logs that a fresh DB init is expected.
- When `RESUME=true` the indexer reads last saved progress from Postgres and continues indexing from the next block.

## Running locally (without Docker)

This project supports running the indexer locally using Node.

Local startup steps (macOS / bash):

1. Install deps:

```bash
yarn
```

2. Create a `.env` file with the required variables:

```bash
cp .env.example .env
```

3. Generate runtime artifacts required by the indexer:

```bash
npx tsx scripts/gen-known-msgs.ts
```

4. Run Postgres:

```bash
make up
```

5. Run the indexer:

```bash
npm run start
```

Notes about NODE_OPTIONS / memory:
- If the indexer needs more memory, set NODE_OPTIONS before running: `export NODE_OPTIONS=--max-old-space-size=24576`.

If you prefer Makefile shortcuts that target Docker, see the `Makefile` in the repo. The Makefile uses `docker compose --env-file .env` for container operations.

## Useful Makefile targets

- `make up` — start db via docker-compose
- `make down` — stop services
- `make reset` — remove volumes and bring DB up again
- `make logs` — show DB logs (`docker compose --env-file .env logs -f db`)
- `make psql` — exec `psql` inside the Postgres container (container name: `blockchainindexer`)
- `make psql-file FILE=path/to/script.sql` — copy and run a SQL file inside the DB container

## Troubleshooting

- If the indexer fails to start due to memory, increase `NODE_OPTIONS` in your environment (see note above).
- Ensure `.env` contains correct Postgres connection details and `RPC_URL` for the chain you want to index.

## Development notes

- The code uses `tsx` to run TypeScript directly during development. Production runs can use `npm run build` and run the compiled output with `node` if desired.
- Tests are not included by default; add small smoke tests if you change core logic.