# Cosmos Indexer API

Read-only HTTP API wrapper for the Cosmos Hub Chain Data Indexer PostgreSQL database.

This branch does not run the indexer itself. It exposes indexed Cosmos Hub data through a Next.js API service with
API-key authentication, OpenAPI documentation, and a small operational surface for deployments.

## Relationship to Chain Data Indexer

The Cosmos Hub indexer lives in the [`main`](https://github.com/citizenweb3/chain-data-indexer/tree/main) branch. Run
that indexer first so it can populate PostgreSQL, then point this API at the same database with `DATABASE_URL`.

Recommended deployment shape:

1. Cosmos Hub indexer writes blockchain data to PostgreSQL.
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
curl -H "x-api-key: $API_KEY" http://localhost:3000/api/v1/blocks
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

- `http://localhost:3000/docs` for API documentation.
- `http://localhost:3000/api/openapi.json` for the OpenAPI document.
- `http://localhost:3000/api/v1/health` for a database health check.

## Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Required | Default | Description |
|---|---:|---|---|
| `DATABASE_URL` | Yes | unset | PostgreSQL connection URL for the Cosmos indexer database. |
| `API_KEY` | Yes | unset | Single expected value for the `x-api-key` request header. |
| `LOG_LEVEL` | No | `info` | `trace`, `debug`, `info`, `warn`, `error`, or `fatal`. |
| `PORT` | No | `3000` | Public port for local Next.js or Docker Compose. |
| `NODE_ENV` | No | `development` | `development`, `test`, or `production`. |

The sample `.env.example` targets a Docker deployment where the API container reaches the host through
`host.docker.internal`. For local `yarn dev` on the host, replace `host.docker.internal` with `localhost` if PostgreSQL
is bound to the host.

## Docker

```bash
cp .env.example .env
# Edit DATABASE_URL and API_KEY
docker compose up --build -d
docker compose logs -f api
```

Docker Compose maps `${PORT:-3000}` on the host to port `3000` inside the container.

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

## Related CDI branches

| Component | Branch | Status |
|---|---|---|
| Cosmos Hub indexer | [`main`](https://github.com/citizenweb3/chain-data-indexer/tree/main) | Production |
