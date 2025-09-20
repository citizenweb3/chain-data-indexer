# Chain Data Indexer: CDI 

[![Build Status](#)](#) [![License: MIT](LICENSE) [![Docker Pulls](#)](#)

## 📚 Table of Contents

- [Repository Overview](#-repository-overview)
- [Features](#-key-features)
- [Architecture](#-architecture)
- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration](#configuration)
- [Usage](#usage)
- [Makefile Shortcuts](#useful-makefile-targets)
- [Troubleshooting](#troubleshooting)
- [Development Notes](#development-notes)
- [Contributing](#contributing)
- [License](#license)

---

## 📚 Repository Overview

**Chain Data Indexer** is a high-performance blockchain data indexers tailored for various blockchain networks. Each indexer is maintained in a separate branch, allowing for network-specific optimizations and independent development.

---

## ✨ Key Features

- 🚀 **High Performance:** Built with TypeScript and optimized for handling large blockchain data volumes.
- 🔄 **Resume Capability:** Smart resumption from the last indexed block, preventing data loss during restarts.
- 🐳 **Docker Ready:** Fully containerized with Docker Compose for easy deployment and scaling.
- 🗄️ **PostgreSQL Integration:** Robust data storage with automatic table partitioning and indexing.
- 📊 **Message Decoding:** Advanced message type detection and decoding capabilities for blockchain transactions.
- ⚡ **Real-time Processing:** Efficient block-by-block processing with configurable concurrency limits.

---

## 🏗️ Architecture

- **RPC Client:** Connects to blockchain RPC endpoints using appropriate libraries for each network.
- **Message Decoder:** Dynamically generates and uses message type definitions specific to each blockchain.
- **Database Layer:** Optimized PostgreSQL schema with automatic partitioning.
- **Configuration System:** Flexible environment-based configuration with validation.

---

## Requirements

- Node.js (v18+ recommended)
- npm or yarn
- Docker & docker-compose

---

## 🚀 Installation

### 1. Clone the repository

```bash
git clone https://github.com/citizenweb3/indexer.git
cd indexer
```

### 2. Install dependencies (for local runs)

```bash
yarn install
# or
npm install
```

---

## ⚡ Quick Start

### Using Docker (Recommended)

1. Copy the example environment file and edit as needed:
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

> The indexer container defaults to `SINK=postgres` and `RESUME=true`, so it will try to resume from the last saved progress when restarted.

#### To reset Postgres and re-init DB:
```bash
docker compose down -v
docker compose --env-file .env up -d db
```

---

## ⚙️ Configuration

All configuration is handled via environment variables. See `.env.example` for all options.

| Variable     | Description                        | Example                       |
| ------------ | ---------------------------------- | ----------------------------- |
| PG_HOST      | PostgreSQL host                    | `localhost`                   |
| PG_PORT      | PostgreSQL port                    | `5432`                        |
| PG_USER      | PostgreSQL user                    | `blockchain`                  |
| PG_PASSWORD  | PostgreSQL password                | `password`                    |
| PG_DATABASE  | PostgreSQL database name           | `indexerdb`                   |
| RPC_URL      | Blockchain RPC endpoint            | `http://127.0.0.1:26657`      |
| SINK         | Data sink type                     | `postgres`                    |
| RESUME       | Resume from last indexed block     | `true`                        |
| NODE_OPTIONS | Node.js runtime options            | `--max-old-space-size=24576`  |

---

## 🖥️ Usage

### Running Locally (Without Docker)

1. Install dependencies:
    ```bash
    yarn install
    # or
    npm install
    ```

2. Create a `.env` file:
    ```bash
    cp .env.example .env
    # Edit .env as necessary
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

> Increase `NODE_OPTIONS` if you need more memory:  
> `export NODE_OPTIONS=--max-old-space-size=24576`

---

## 🛠️ Useful Makefile Targets

- `make up` — Start db via docker-compose
- `make down` — Stop services
- `make reset` — Remove volumes and re-init DB
- `make logs` — Show DB logs (`docker compose --env-file .env logs -f db`)
- `make psql` — Exec `psql` inside the Postgres container
- `make psql-file FILE=path/to/script.sql` — Copy and run a SQL file inside the DB container

---

## 🩺 Troubleshooting

- Indexer fails to start due to memory? Increase `NODE_OPTIONS` in your environment.
- Ensure `.env` contains correct Postgres connection details and `RPC_URL` for the chain you want to index.
- Use `make reset` to clear out and reinitialize your database if needed.

---

## 🧑‍💻 Development Notes

- The code uses `tsx` to run TypeScript directly during development.  
  Production runs can use `npm run build` and run the compiled output with `node` if desired.
- Tests are not included by default; add small smoke tests if you change core logic.
- For advanced Docker/Makefile usage, refer to the Makefile and Docker Compose files.

---

## 🤝 Contributing

Contributions are welcome! Please open issues and pull requests for improvements, bug fixes, or new features.  
For major changes, please open an issue first to discuss what you would like to change.

See [CONTRIBUTING.md](CONTRIBUTING.md) if available.

---

## 📄 License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.

---
