This README explains how to run the indexer with Docker Compose.

- Build and start services:

```bash
# create .env with required PG_* and RPC_URL
# bring up Postgres (initdb scripts will run on first initialization)
docker compose --env-file .env up -d db
# build and start the indexer and other services
docker compose --env-file .env up --build -d
```

- To run indexer service logs:

```bash
docker compose --env-file .env logs -f indexer
```

Notes:
- The indexer container sets SINK=postgres and RESUME=true by default to resume indexing from the last saved progress.
 - If you need to force a fresh reset of DB schema, recreate the Postgres volume from the host. For example:

```bash
docker compose --env-file .env down -v
docker compose --env-file .env up -d db
```
Behavior notes
 - First start (fresh Postgres volume): the `initdb/*.sql` scripts mounted by `docker-compose.override.yaml` are executed by the Postgres image on first initialization. The indexer container waits for Postgres to become healthy and then checks whether the progress table exists in the DB; if it's not present, it logs that a fresh DB init is expected.
 - Resume: when `RESUME=true` (default in the compose file) the indexer will query Postgres for the last saved progress (see `src/db/progress.ts`) and continue indexing from the next block. This allows stopping and restarting the indexer without reprocessing already-indexed blocks.
 - Forcing reset: resetting the DB (removing the Postgres volume) must be done from the host (outside the indexer container), for example:

```bash
# stop compose and remove volumes (will drop DB data)
docker compose --env-file .env down -v
# bring DB up again so initdb scripts run
docker compose --env-file .env up -d db
```

After that, start the indexer normally. The project `Makefile` also provides `make reset` which performs `docker compose down -v && make up`.

Troubleshooting
 - If the indexer fails to start because of memory, increase `NODE_OPTIONS` in `.env` or override in the compose file. The original start command uses:

```bash
NODE_OPTIONS="--max-old-space-size=24576" npm run start
```

You can set the same in `.env` as `NODE_OPTIONS=--max-old-space-size=24576` or pass it when running compose.
