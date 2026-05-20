# Chain Data Indexer: CDI

> built by [Citizen Web3](https://www.citizenweb3.com/) for [ValidatorInfo](https://validatorinfo.com/)

## Repository Map

CDI is organized as a branch-based monorepo: each network indexer lives in its own branch, while
companion services, such as API wrappers, live in dedicated branches next to the indexers.

### Indexers

| Network            | Branch                                                                                      | Status         | Purpose                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------- |
| **Cosmos Hub**     | [`main`](https://github.com/citizenweb3/chain-data-indexer/tree/main)                       | ✅ Production  | Cosmos Hub indexer with Protobuf decoding, transaction parsing, PostgreSQL storage, and metrics |
| **AtomOne**        | [`atomone-indexer`](https://github.com/citizenweb3/chain-data-indexer/tree/atomone-indexer) | ✅ Production  | AtomOne mainnet indexer with governance, IBC packets, staking, and PostgreSQL storage           |
| **Aztec Protocol** | [`aztec`](https://github.com/citizenweb3/chain-data-indexer/tree/aztec)                     | ✅ Production  | Aztec indexer stack for explorer and analytics workloads                                        |
| **Logos**          | [`logos-indexer-v0.1.2`](https://github.com/citizenweb3/chain-data-indexer/tree/logos-indexer-v0.1.2) | 🚧 Development | Logos testnet indexer with canonical-chain, finality, transaction, and explorer API data        |
| **Monero**         | [`monero-indexer`](https://github.com/citizenweb3/chain-data-indexer/tree/monero-indexer)   | 🚧 Development | Monero indexer for blocks, transactions, supply checkpoints, health, metrics, and explorer APIs |
| **Polygon Miden**  | [`miden-indexer-v0.13.4`](https://github.com/citizenweb3/chain-data-indexer/tree/miden-indexer-v0.13.4) | 🚧 Development | Polygon Miden indexer with HTTP API, observability, and PostgreSQL storage                      |

### Companion Components

| Component            | Branch                                                                                              | Status      | Purpose                                                              |
| -------------------- | --------------------------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------- |
| **Cosmos Indexer API** | [`cosmos-indexer-api`](https://github.com/citizenweb3/chain-data-indexer/tree/cosmos-indexer-api) | API wrapper | Read-only Next.js API over the Cosmos Hub indexer PostgreSQL database |
| **AtomOne Indexer API** | [`atomone-indexer-api`](https://github.com/citizenweb3/chain-data-indexer/tree/atomone-indexer-api) | API wrapper | Read-only Next.js API over the AtomOne indexer PostgreSQL database |

> Each branch contains network-specific configuration, schemas, and documentation. The instructions below are for the
> **Cosmos Hub indexer** in `main`.

---

## 📚 Table of Contents

- [Repository Map](#repository-map)
- [Cosmos Hub Indexer](#cosmos-hub-indexer)
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

## Cosmos Hub Indexer

The `main` branch contains the production **Cosmos Hub** implementation of Chain Data Indexer (CDI).
It extracts, processes, and stores Cosmos Hub blockchain data in PostgreSQL for block explorers, analytics platforms,
DeFi dashboards, compliance tools, and research projects.

- 🧭 **Primary Use Case:** Powering block explorers with rich, searchable blockchain data.
- 🌌 **Extensible:** Suitable for analytics, compliance, DeFi, R&D, and more.
- 🌐 **Multi-Network:** CDI also includes separate branches for AtomOne, Aztec, Logos, Monero, and Polygon Miden indexers.

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

| Variable                   | Description                                                                    | Example                                           |
| -------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| PG_HOST                    | PostgreSQL host                                                                | `localhost`                                       |
| PG_PORT                    | PostgreSQL port                                                                | `5432`                                            |
| PG_USER                    | PostgreSQL user                                                                | `blockchain`                                      |
| PG_PASSWORD                | PostgreSQL password                                                            | `password`                                        |
| PG_DATABASE                | PostgreSQL database name                                                       | `indexerdb`                                       |
| RPC_URL                    | Blockchain RPC endpoint                                                        | `https://rpc.cosmoshub-4-archive.citizenweb3.com` |
| SINK                       | Data sink type                                                                 | `postgres`                                        |
| RESUME                     | Resume from last indexed block                                                 | `true`                                            |
| PG_BULK_MODE               | Drop indexes + UNLOGGED partitions for fast backfill (auto-restored on follow) | `true`                                            |
| HEALTH_PORT                | TCP port for `/health` and `/metrics` endpoints                                | `3000`                                            |
| HEALTH_STALE_SECONDS       | Block-progress freshness threshold                                             | `180`                                             |
| METRICS_ENABLED            | Expose Prometheus `/metrics` on `HEALTH_PORT`                                  | `true`                                            |
| METRICS_SAMPLE_INTERVAL_MS | Sampler refresh interval (pg pool, decode pool, chain tip)                     | `5000`                                            |
| LOG_FORMAT                 | `pretty` (default, human-readable) or `json` (Loki/ELK)                        | `pretty`                                          |
| NODE_OPTIONS               | Node.js runtime options                                                        | `--max-old-space-size=24576`                      |

---

## Usage

### Bulk Backfill Mode

For fresh bulk backfills on a new PostgreSQL volume, you can skip the heaviest
secondary indexes during init and rebuild them after the range finishes.

Start a fixed backfill window with deferred heavy indexes:

```bash
INDEXER_RESTART_POLICY=no \
PG_DEFER_HEAVY_INDEXES=on \
RESUME=false \
FROM=9000000 \
TO=9002499 \
docker compose --env-file .env.production up --build -d
```

After the range finishes, stop the indexer, bring the database back up if needed,
and rebuild the skipped indexes:

```bash
docker compose --env-file .env.production up -d db
make rebuild-heavy-indexes
```

This mode does not change indexed row content. It only removes selected heavy
secondary indexes from the write path during the backfill.

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
   yarn start
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
- `make rebuild-heavy-indexes` — Recreate heavy secondary indexes skipped by bulk backfill mode

---

## Troubleshooting

- Indexer fails due to memory? Increase `NODE_OPTIONS`.
- Check your `.env` for correct DB and RPC settings.
- Use `make reset` to reinitialize your database if needed.
- Container keeps exiting? Check `curl http://127.0.0.1:${HEALTH_PORT:-3000}/health`
  and `docker inspect cosmos-indexer-app --format '{{.State.Health.Status}}'`.
  See the **Monitoring & Maintenance** section in [DEPLOYMENT.md](DEPLOYMENT.md).
- Need Prometheus metrics or log shipping? `curl http://127.0.0.1:${HEALTH_PORT:-3000}/metrics`
  for the `cdi_*` series, set `LOG_FORMAT=json` for structured logs, and use
  the reference collector configs in [`docs/observability/`](docs/observability/)
  (Grafana Alloy or classic Prometheus + Promtail).
- RPC archive node temporarily unavailable? The indexer now waits and resumes
  automatically (no crash loop) — see logs for `[rpc] startup: RPC unavailable`
  / `RPC is available again`.

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
