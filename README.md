# AtomOne Indexer API

Read-only HTTP API wrapper for the AtomOne Chain Data Indexer PostgreSQL database.

This branch does not run the indexer itself. It exposes indexed AtomOne data through a Next.js API service with
API-key authentication, OpenAPI documentation, and a small operational surface for deployments.

## Relationship to Chain Data Indexer

The AtomOne indexer lives in the
[`atomone-indexer`](https://github.com/citizenweb3/chain-data-indexer/tree/atomone-indexer) branch. Run that indexer
first so it can populate PostgreSQL, then point this API at the same database with `DATABASE_URL`.

Recommended deployment shape:

1. AtomOne indexer writes blockchain data to PostgreSQL.
2. This API connects to PostgreSQL with a read-only database role.
3. ValidatorInfo or another frontend calls this API with an `x-api-key` header.

## Features

- Next.js route handlers for blocks, transactions, stats, health, OpenAPI, and docs.
- `x-api-key` authentication for data endpoints.
- OpenAPI 3.1 document at `GET /api/openapi.json`.
- Scalar API reference UI at `GET /docs`.
- Keyset-style pagination for block and transaction lists.
- Immutable cache headers for block and transaction detail responses.
- Pino logging and Zod environment validation.
- Dockerfile and Docker Compose service for deployment.

## API surface

Data endpoints require the configured API key:

```bash
curl -H "x-api-key: $API_KEY" http://localhost:3080/api/v1/blocks
```

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/v1/health` | Public | Database reachability check. Returns `200` for `ok` or `503` for `degraded`. |
| `GET` | `/api/v1/blocks` | `x-api-key` | Latest-first block list. Supports `limit` and `before_height`. |
| `GET` | `/api/v1/blocks/height/:h` | `x-api-key` | Block detail by height. |
| `GET` | `/api/v1/blocks/stats` | `x-api-key` | Block count/head statistics. |
| `GET` | `/api/v1/txs` | `x-api-key` | Latest-first transaction list. Supports `limit`, `before_height`, and `before_index`. |
| `GET` | `/api/v1/txs/:hash` | `x-api-key` | Transaction detail with messages and events. |
| `GET` | `/api/v1/txs/:hash/raw` | `x-api-key` | Raw indexed transaction payload. |
| `GET` | `/api/v1/txs/stats` | `x-api-key` | Transaction count/height statistics. |
| `GET` | `/api/openapi.json` | Public | Generated OpenAPI 3.1 document. |
| `GET` | `/docs` | Public | Scalar API reference UI. |

## Quick start

```bash
yarn install --frozen-lockfile
cp .env.example .env
# Edit .env: set DATABASE_URL and API_KEY
yarn dev
```

Then open:

- `http://localhost:3080/docs` for API documentation.
- `http://localhost:3080/api/openapi.json` for the OpenAPI document.
- `http://localhost:3080/api/v1/health` for a database health check.

## Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Required | Default | Description |
|---|---:|---|---|
| `DATABASE_URL` | Yes | unset | PostgreSQL connection URL for the AtomOne indexer database. |
| `API_KEY` | Yes | unset | Single expected value for the `x-api-key` request header. |
| `LOG_LEVEL` | No | `info` | `trace`, `debug`, `info`, `warn`, `error`, or `fatal`. |
| `PORT` | No | `3080` | Host port bound to the container's internal port `3000`. |
| `NODE_ENV` | No | `production` | `development`, `test`, or `production`. |

The sample `.env.example` targets the production-style deployment used on the AtomOne indexer host:
the API joins `atomone-indexer-net` and reaches PostgreSQL at `atomoneindexer:5432`. For local `yarn dev` on the host,
replace `atomoneindexer:5432` with `localhost:2433`.

## Docker

```bash
cp .env.example .env
# Edit DATABASE_URL and API_KEY
docker compose up --build -d
docker compose logs -f api
```

Docker Compose maps `127.0.0.1:${PORT:-3080}` on the host to port `3000` inside the container.

## AtomOne deployment bootstrap

The dedicated AtomOne deployment uses a separate worktree and a read-only PostgreSQL role.

```bash
cd /pool0/atomone-indexer
git worktree add /pool0/atomone-indexer-api atomone-indexer-api

RO_PASSWORD=$(openssl rand -base64 48 | tr -d '/+=' | head -c 48)
docker cp docs/010-readonly-api-role.sql atomoneindexer:/tmp/010.sql
docker exec -e PGPASSWORD="$PG_PASSWORD" atomoneindexer \
  psql -U atomone_indexer_user -d atomone_indexer_db -v ON_ERROR_STOP=1 \
       -v api_ro_password="$RO_PASSWORD" -f /tmp/010.sql
docker exec atomoneindexer rm /tmp/010.sql
printf '%s' "$RO_PASSWORD" | install -m 600 /dev/stdin /pool0/atomone-indexer-api/.api-ro.password

docker network create atomone-indexer-net || true
```

At runtime the API should use:

- `DATABASE_URL=postgres://atomone_api_ro:<password>@atomoneindexer:5432/atomone_indexer_db`
- `PORT=3080`
- a long random `API_KEY`

If you harden `pg_hba.conf`, place these rules above any `trust` line and reload PostgreSQL:

```text
host    atomone_indexer_db   atomone_api_ro   172.26.0.0/16   scram-sha-256
host    all                  atomone_api_ro   all             reject
```

## Development commands

| Command | Description |
|---|---|
| `yarn dev` | Start the Next.js development server. |
| `yarn build` | Build the production Next.js app. |
| `yarn start` | Start the built production app. |
| `yarn typecheck` | Run TypeScript without emitting files. |
| `yarn lint` | Run ESLint over `src`. |

## Operations notes

- Use a dedicated read-only PostgreSQL role for this API in shared or production environments.
- Keep `API_KEY` long and random; only a single key is supported by the current implementation.
- `/api/v1/health` checks database reachability and intentionally does not require an API key.
- Most data routes return `401` when the `x-api-key` header is missing or invalid.
- The OpenAPI document is generated from `src/lib/openapi.ts`; update it when adding or changing routes.
- This AtomOne branch assumes the API lives in `/pool0/atomone-indexer-api`, separate from the indexer checkout.

## Related CDI branches

| Component | Branch | Status |
|---|---|---|
| AtomOne indexer | [`atomone-indexer`](https://github.com/citizenweb3/chain-data-indexer/tree/atomone-indexer) | Production |
