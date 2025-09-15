# Cosmos Indexer DB (Dockerized)

## Project Description

**Cosmos Indexer DB** is a ready-to-use Postgres database for storing and analyzing data from blockchains in the Cosmos ecosystem. The project provides infrastructure for quickly deploying a structured database that can store blocks, transactions, events, and other data from various Cosmos-compatible networks.

As a result, you get a containerized environment with a configured schema, partitions, and indexes, allowing efficient storage and analysis of large volumes of blockchain data.

## Why You Need This

- **For Developers:** quick deployment of a database to store data from Cosmos networks, creation of custom indexers, services, backends, and integrations.
- **For Analysts:** a convenient structure for writing SQL queries, building reports and dashboards, analyzing transactions, address activity, and more.

## Architecture

- Uses `docker-compose` to deploy Postgres in a container.
- Initialization scripts (`initdb/*.sql`) are automatically applied on the first cluster startup:
  - creating extensions and parameters,
  - creating the main schema of tables,
  - adding indexes and patches,
  - auxiliary partitions and utilities.
- All parameters (versions, ports, credentials) are placed in `.env`.

## How to Use

1. **Clone the repository:**
   ```bash
   git clone https://github.com/your-org/cosmos-indexer-db.git
   cd cosmos-indexer-db
   ```

2. **Configure parameters in the `.env` file:**
   - Specify versions, ports, logins, and passwords for Postgres.

3. **(Optional) Insert your own schema:**
   - If needed, replace the contents of `initdb/010-indexer-schema.sql` with your schema.

4. **Start the database:**
   ```bash
   make up
   ```

5. **View logs:**
   ```bash
   make logs
   ```

6. **Connect to the database via psql:**
   ```bash
   make psql
   ```

7. **Execute an arbitrary SQL script:**
   ```bash
   make psql-file FILE=path/to/script.sql
   ```

> **Important:** Scripts from `initdb/*.sql` are executed **only on the first cluster startup**. If you modify them after the first run, recreate the volume using `docker compose down -v` or run the required scripts manually via `make psql-file`.

## Repository Structure

- `docker-compose.yaml` — main service (Postgres, volume).
- `docker-compose.override.yaml` — mounts `./initdb`, adds healthcheck.
- `.env` — environment variables: versions, credentials, port.
- `Makefile` — convenient commands for managing containers and the database.

## How This Can Be Used

- **Creating Custom Indexers:** populate the database with data from Cosmos networks using your own ETL scripts or ready-made solutions (e.g., substreams, indexers).
- **Analytics and Reporting:** write SQL queries to analyze transactions, addresses, events, and other entities.
- **Dashboards and BI:** connect BI tools (Metabase, Grafana, Superset) directly to the database to visualize data.
- **Service Backends:** use the database as a data source for your APIs, services, Telegram bots, and other applications.

## Open Source

This project is open-source and available for the community to use, contribute, and extend.

## License

MIT License.# indexer
