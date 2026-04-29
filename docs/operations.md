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

## Verify

```sh
curl http://localhost:15080/health
curl http://localhost:15080/api/v1/stats
```

The stats response should be JSON. During live operation, `last_block` should advance as the local `miden-node` advances.

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
