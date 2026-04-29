# Miden indexer operations

## Prerequisites

- Docker with the Compose plugin.
- A live `miden-node` reachable on the host at `127.0.0.1:57291` / `0.0.0.0:57291`.
- On Linux, Compose maps `host.docker.internal` to the Docker host gateway so the indexer container can call the host node.

## Bootstrap

```sh
cp .env.example .env
# Edit .env and change POSTGRES_PASSWORD before using this outside local development.
docker compose up -d
```

Postgres initializes from `initdb/001-schema.sql` on the first boot of an empty `miden_pgdata` volume. The indexer waits for Postgres to become healthy, then starts the API and indexing loop.

## First-run monitoring

Startup is normally under a minute once the image is built. Large backfills take longer, but `/health` should respond after the API starts. Monitor with:

```sh
docker compose logs -f indexer
```

## Local override (host firewall blocks Docker bridge → miden-node)

If the indexer container can reach Postgres but `host.docker.internal:57291` times out (UFW/firewalld blocks the Docker bridge), use a local-only override that joins the indexer to the host network. The override file is gitignored.

```sh
cat > docker-compose.override.yaml <<'EOF'
services:
  indexer:
    network_mode: host
    extra_hosts: !reset []
    ports: !reset []
    environment:
      NODE_URL: http://127.0.0.1:57291
      DATABASE_URL: postgres://${POSTGRES_USER:-miden}:${POSTGRES_PASSWORD:-changeme}@127.0.0.1:${POSTGRES_HOST_PORT:-15433}/${POSTGRES_DB:-miden_indexer}
      PG_HOST: 127.0.0.1
      PG_PORT: ${POSTGRES_HOST_PORT:-15433}
      API_PORT: ${API_HOST_PORT:-15080}
      INDEXER_HTTP_PORT: ${API_HOST_PORT:-15080}
EOF
docker compose up -d
```

In this mode the indexer's API binds directly to the host on `API_HOST_PORT` (15080 by default). Open the port in the host firewall (`ufw allow 15080/tcp`) if external explorer access is required.

## Crash and RPC-disconnect recovery

The indexer is designed to resume from where it stopped without manual intervention:

- Every batch is one Postgres transaction; progress (`miden_indexer_progress.last_block`) is upserted with `GREATEST` inside that transaction. A crash mid-batch rolls the whole batch back, so progress is never ahead of committed data.
- On startup the runner reads `last_block` from the DB and gap-fills from `last_block + 1` to current chain tip via `syncRange` before entering the live-follow loop.
- The follow loop catches transient RPC errors and retries with exponential backoff (2s … 60s). It does not exit on RPC errors.
- Sink writes use `ON CONFLICT DO NOTHING`, so a re-run over already-indexed blocks is a no-op.
- Compose uses `restart: unless-stopped`. If the process exits anyway (uncaught error during initial gap-fill, OOM, etc.), Docker restarts the container and the same gap-fill kicks in.

To verify locally: `docker kill miden-indexer-indexer-1` mid-backfill, watch the container restart, confirm `last_block` continues from where it stopped with no gaps (`SELECT count(*) FROM miden_blocks` matches `last_block + 1`).

## Backfill from a specific block

Set `START_BLOCK` in `.env`, then recreate the indexer container:

```sh
docker compose up -d --force-recreate indexer
```

Saved database progress wins after blocks have already been indexed. To truly restart from a different block, reset the database volume first.

## Backup

```sh
docker compose exec postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /var/lib/postgresql/data/miden-indexer.dump'
```

Copy the dump out if needed:

```sh
docker compose cp postgres:/var/lib/postgresql/data/miden-indexer.dump ./miden-indexer.dump
```

## Restore

With `miden-indexer.dump` in the repository directory:

```sh
docker compose cp ./miden-indexer.dump postgres:/var/lib/postgresql/data/miden-indexer.dump
docker compose exec postgres sh -c 'dropdb -U "$POSTGRES_USER" --if-exists "$POSTGRES_DB"'
docker compose exec postgres sh -c 'createdb -U "$POSTGRES_USER" "$POSTGRES_DB"'
docker compose exec postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists /var/lib/postgresql/data/miden-indexer.dump'
docker compose up -d --force-recreate indexer
```

## Resetting

```sh
docker compose down -v
```

Warning: `-v` deletes the named Postgres volume and all indexed data. Without `-v`, `docker compose down` stops containers but keeps data.

## Resource sizing

The local `miden-node` SQLite database is about 2.4 GB around block 2M. The indexer Postgres database grows roughly linearly with indexed block, transaction, note, nullifier, and account data. Plan for several GB at current chain size plus ongoing growth, and keep extra disk for Postgres vacuum and backups.

## Troubleshooting

- **Indexer cannot reach the node:** confirm the host node listens on `0.0.0.0:57291` (`ss -ltn | grep 57291`); keep `NODE_URL=http://host.docker.internal:57291`; verify Compose includes `extra_hosts: ["host.docker.internal:host-gateway"]`. On hosts with UFW/firewalld active, the Docker bridge subnet (typically `172.17.0.0/16` or the per-project bridge, see `docker network inspect miden-indexer_default`) must be allowed to reach the host port; otherwise the container will time out on connect even though `curl` from the host succeeds. Quick check from inside the container: `docker compose exec indexer wget -qO- http://host.docker.internal:57291` (expect a gRPC handshake error, not a timeout). If timing out, add a firewall allow rule for the Docker bridge subnet to TCP 57291, or set `NODE_URL` to the host's LAN IP that the container can reach.
- **Postgres schema did not initialize:** files in `initdb/` run only when the Postgres data directory is empty. Use `docker compose down -v` to reinitialize, after backing up any data.
- **Port collisions:** change `POSTGRES_HOST_PORT`, `API_HOST_PORT`, or `ADMINER_HOST_PORT` in `.env`. Defaults are `15432`, `15080`, and `15081`.
- **Unhealthy indexer:** check `docker compose logs indexer` for config, database, or RPC errors; check `curl http://localhost:15080/health` from the host.

## Upgrading

```sh
git pull
docker compose build indexer
docker compose up -d indexer
```

There are currently no automatic schema migrations. New SQL files in `initdb/` run only on fresh volumes; existing deployments need an explicit migration plan before upgrading across schema changes.
