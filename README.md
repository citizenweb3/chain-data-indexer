# Cosmos Indexer

## Project Description

Indexer for the Cosmos Hub network. Note: the project generates a runtime file `src/generated/knownMsgs.ts` required by the decoder; Docker image build runs this generator automatically.

...existing code...

## Requirements

- Node.js
- npm
- yarn

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
- `make psql` — exec `psql` inside the Postgres container (container name: `cosmosindexer`)
- `make psql-file FILE=path/to/script.sql` — copy and run a SQL file inside the DB container

## Troubleshooting

- If the indexer fails to start due to memory, increase `NODE_OPTIONS` in your environment (see note above).
- Ensure `.env` contains correct Postgres connection details and `RPC_URL` for the chain you want to index.

## Development notes

- The code uses `tsx` to run TypeScript directly during development. Production runs can use `npm run build` and run the compiled output with `node` if desired.
- Tests are not included by default; add small smoke tests if you change core logic.

## License

MIT
