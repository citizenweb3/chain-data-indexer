# miden-indexer

Block indexer for Polygon Miden.

> Scaffold in progress, see `docs/` and `AGENTS.md`.

This repository is a Miden-named skeleton branched from the inherited indexer code. Network-specific RPC, schema, sink, runner, Docker operations, and API details are intentionally stubbed for downstream agents to fill in.

## Quick start

```bash
cd /pool0/miden-indexer
npm install
cp .env.example .env
# Edit .env: set PG_PASSWORD and DATABASE_URL for your PostgreSQL instance.
npm run db:init
npm run dev
```

TBD by downstream agents: confirmed Miden node prerequisites, schema initialization beyond progress tracking, and full indexing workflow.

## With Docker

```bash
cd /pool0/miden-indexer
cp .env.example .env
# Edit .env: set PG_PASSWORD and Miden NODE_URL if not using the placeholder.
docker compose up -d --build
```

TBD by `docker-ops` agent: final Docker image, service layout, health checks, and production operations guidance.

## Configuration

See [`.env.example`](.env.example) for all scaffold defaults.

| Variable | Default | Description |
|---|---|---|
| `NODE_URL` | `http://127.0.0.1:57291` | Placeholder Miden node endpoint. TBD by RPC agent. |
| `DATABASE_URL` | `postgresql://miden:CHANGE_ME@localhost:5432/miden_indexer` | PostgreSQL URL for `npm run db:init`. |
| `PG_*` | see `.env.example` | PostgreSQL connection used by the runtime pool. |
| `INDEXER_HTTP_PORT` | `3001` | HTTP port for `/health` and stub `/api/v1/*` routes. |
| `START_BLOCK` | `0` | First block number when no saved progress exists. TBD by runner agent. |
| `BATCH_SIZE` | `100` | Placeholder batch size. TBD by runner/RPC agents. |
| `POLL_INTERVAL_MS` | `5000` | Placeholder polling interval. TBD by runner agent. |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, or `error`. |

## Current scaffold status

- `/health` returns `{ ok: true, lag: null, uptime_s }`.
- `/api/v1/stats`, `/api/v1/blocks`, `/api/v1/blocks/:n`, `/api/v1/notes`, `/api/v1/nullifiers`, and `/api/v1/accounts/:id` return `501 Not Implemented`.
- `src/rpc/client.ts`, `src/sink/postgres.ts`, and `src/runner/*` are stubs awaiting downstream implementation.
- `initdb/001-schema.sql` creates only `miden_indexer_progress` for now.
