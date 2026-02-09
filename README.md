# Chain Data Indexer: CDI

> built by [Citizen Web3](https://www.citizenweb3.com/) for [ValidatorInfo](https://validatorinfo.com/)

## Chains

- [Cosmos Hub](https://github.com/citizenweb3/chain-data-indexer/tree/main) - Development 🚧
- [Aztec Protocol](https://github.com/citizenweb3/chain-data-indexer/tree/aztec) - Production ✅

---

## 📚 Table of Contents

- [Overview](#overview)
- [Supported Networks](#supported-networks)
- [Features](#features)
- [Architecture](#architecture)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Usage](#usage)
- [Makefile Shortcuts](#makefile-shortcuts)
- [Troubleshooting](#troubleshooting)
- [Development Notes](#development-notes)
- [Contributing](#contributing)
- [License](#license)

---

## Overview

**Chain Data Indexer (CDI)** is a high-performance, modular blockchain data indexer designed for powering block explorers, analytics platforms, DeFi dashboards, compliance tools, and research projects.  
It extracts, processes, and stores blockchain data from various networks into a PostgreSQL database, enabling fast and flexible querying.

- 🧭 **Primary Use Case:** Powering block explorers with rich, searchable blockchain data.
- 🌌 **Extensible:** Suitable for analytics, compliance, DeFi, R&D, and more.
- 🌐 **Multi-Network:** This is a monorepo with indexers for multiple blockchain networks.

---

## Supported Networks

CDI supports multiple blockchain networks. Each network has its own dedicated branch with specialized implementation:

| Network | Branch | Status | Description |
|---------|--------|--------|-------------|
| **Cosmos Hub** | [`main`](https://github.com/citizenweb3/chain-data-indexer/tree/main) | ✅ Production | Full indexer for cosmoshub-4 with Protobuf decoding, transaction parsing, and PostgreSQL storage |
| **Aztec Protocol** | [`aztec`](https://github.com/citizenweb3/chain-data-indexer/tree/aztec) | 🚧 Development | High-performance L2 indexer with REST API, Kafka streaming, and parallel block processing (270-280 blocks/sec) |

### Switching Networks

To work with a specific network indexer, switch to the corresponding branch:

```bash
# For Cosmos Hub indexer (this branch)
git checkout main

# For Aztec Protocol indexer
git checkout aztec
```

> 💡 **Note:** Each branch contains network-specific configuration, schemas, and documentation. Make sure to read the branch-specific README for detailed setup instructions.

---

## Features

> **Note:** The features below are specific to the **Cosmos Hub** indexer. For other networks, please refer to the respective branch documentation.

- 🚀 **High Performance:** Efficiently processes large volumes of blocks and transactions.
- 🔄 **Resumable Indexing:** Smart resumption from the last indexed block to prevent data loss.
- 🐳 **Dockerized:** Simple deployment with Docker Compose.
- 🗄️ **PostgreSQL Integration:** Robust, scalable storage with partitioning and indexing.
- 📊 **Advanced Decoding:** Supports rich message/transaction type extraction.
- ⚡ **Real-time Capable:** Block-by-block processing with adjustable concurrency.
- 🔌 **Modular Branches:** Each supported network can be developed and maintained independently.

---

## Architecture

- **RPC Client:** Interfaces with blockchain RPC endpoints.
- **Message Decoder:** Dynamically generates message type definitions for supported chains.
- **Database Layer:** Optimized PostgreSQL schema with automatic partitioning.
- **Configuration System:** Environment-based, validated configuration.

---

## Requirements

- Node.js (v22+ recommended or v22.18.0 LTS for the best experience)
- yarn
- Docker & docker-compose

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/citizenweb3/indexer.git
cd indexer
```

### 2. Install dependencies (for local runs)

```bash
yarn install --frozen-lockfile
```

---

## Quick Start

### Using Docker (Recommended)

1. Copy and configure your environment:
   ```bash
   cp .env.example .env
   # Edit .env as needed
   ```

2. Build and start all services:
   ```bash
   docker compose --env-file .env up --build -d
   ```

3. View indexer logs:
   ```bash
   docker compose logs -f indexer
   ```

> By default, the indexer will resume from the last processed block (`RESUME=true`) and use Postgres as the sink.

#### To reset Postgres and re-initialize the database:
```bash
docker compose down -v
```
```bash
docker compose --env-file .env up -d db
```

---

## Configuration

All configuration is managed through environment variables.  
See `.env.example` for a complete list.

| Variable     | Description                        | Example                  |
| ------------ | ---------------------------------- | ------------------------ |
| PG_HOST      | PostgreSQL host                    | `localhost`              |
| PG_PORT      | PostgreSQL port                    | `5432`                   |
| PG_USER      | PostgreSQL user                    | `blockchain`             |
| PG_PASSWORD  | PostgreSQL password                | `password`               |
| PG_DATABASE  | PostgreSQL database name           | `indexerdb`              |
| RPC_URL      | Blockchain RPC endpoint            | `https://rpc.cosmoshub-4-archive.citizenweb3.com` |
| SINK         | Data sink type                     | `postgres`               |
| RESUME       | Resume from last indexed block     | `true`                   |
| NODE_OPTIONS | Node.js runtime options            | `--max-old-space-size=24576` |

---

## Usage

### Running Locally (Without Docker)

1. Install dependencies:
    ```bash
    yarn install --frozen-lockfile
    ```

2. Create a `.env` file:
    ```bash
    cp .env.example .env
    # Edit as necessary
    ```

3. Generate runtime artifacts:
    ```bash
    npx tsx scripts/gen-known-msgs.ts
    ```

4. Run Postgres (via Docker):
    ```bash
    make up
    ```

5. Start the indexer:
    ```bash
    npm run start
    ```

> Need more memory?  
> `export NODE_OPTIONS=--max-old-space-size=24576`

---

## Makefile Shortcuts

- `make up` — Start db via docker-compose
- `make down` — Stop services
- `make reset` — Remove volumes and re-init DB
- `make logs` — Show DB logs (`docker compose --env-file .env logs -f db`)
- `make psql` — Exec `psql` inside the Postgres container
- `make psql-file FILE=path/to/script.sql` — Copy and run a SQL file inside the DB container

---

## Troubleshooting

- Indexer fails due to memory? Increase `NODE_OPTIONS`.
- Check your `.env` for correct DB and RPC settings.
- Use `make reset` to reinitialize your database if needed.

---

## Development Notes

- Runs TypeScript directly via `tsx` during development.
- No tests by default; please add smoke tests for core logic changes.
- See Makefile and Docker Compose files for advanced operations.

---

## Contributing

Contributions are welcome!  
Open issues/PRs for improvements, bug fixes, or new features.

For significant changes, please open an issue to discuss your ideas first.

---

## License

[`BE GOOD` License](LICENSE-BG) for details.

---
