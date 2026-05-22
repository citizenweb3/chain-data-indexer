<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Crosschain IBC Indexer

Map-of-Zones–style dashboard for IBC transfers on Cosmos Hub. A Next.js 16 app (RSC) renders stats, channels, per-asset breakdowns, time-series, and a transfers explorer on top of a Postgres warehouse that is populated by a Node worker. The worker syncs IBC packets from an upstream `chain-data-indexer` deployment, recomputes daily rollups, and pulls CoinGecko prices for all seeded assets (~56).

## Tech stack

- **Runtime**: Node 22 (Alpine in Docker), Next.js 16.2 (Turbopack dev), React 19.2
- **DB**: Postgres 16 with `NULLS NOT DISTINCT` PKs and `GROUPING SETS` rollups
- **ORM**: Prisma 7.8 with the `@prisma/adapter-pg` driver adapter (so we can run raw SQL via `pg`)
- **API validation / OpenAPI**: Zod 4 + `@asteasolutions/zod-to-openapi` + Scalar UI for `/docs`
- **Worker**: `tsx` + `cron@4` (`CronJob`) + `worker_threads` (dispatcher in `server/indexer.ts`)
- **UI**: Tailwind v4 (`@tailwindcss/postcss`), chart.js + `react-chartjs-2` + `chartjs-plugin-zoom`
- **Lint/Format**: eslint flat config (`eslint.config.mjs`), prettier with `prettier-plugin-tailwindcss`
- **Package manager**: yarn 1.22 (classic) — do not introduce `pnpm-lock.yaml` or `package-lock.json` (both are gitignored)

## Architecture

```
┌──────────────────────┐        ┌──────────────────────┐
│ Upstream indexer-API │◀──────▶│ worker  (Node, cron) │
│ (chain-data-indexer) │        │  - sync-ibc-transfers │
└──────────────────────┘        │  - recompute-daily…   │
                                │  - prices             │
┌──────────────────────┐        │  - price-history      │
│ CoinGecko (USD)      │◀──────▶│                      │
└──────────────────────┘        └──────────┬───────────┘
                                           │ SQL (raw + Prisma)
                                           ▼
                                ┌──────────────────────┐
                                │  Postgres 16         │
                                │  ibc_packets         │
                                │  ibc_daily_stats     │
                                │  prices, price_…     │
                                │  sync_cursors, …     │
                                └──────────┬───────────┘
                                           │ Prisma + raw SQL
                                           ▼
                                ┌──────────────────────┐   ┌────────┐
                                │ web  (Next 16, RSC)  │──▶│ /docs  │
                                │  - /api/v1/*         │   │ Scalar │
                                │  - /dashboard, …     │   └────────┘
                                └──────────────────────┘
```

Two long-running processes share the same `DATABASE_URL`:

- **web** (`yarn dev` / `yarn start`) — Next.js standalone output. Serves RSC pages (`/dashboard`, `/channels/[channel]`, `/assets`, `/transfers`, `/transfers/[port]/[channel]/[sequence]`, `/docs`) and the JSON API under `/api/v1/*`. Never writes to the DB outside of read-only queries and OpenAPI generation.
- **worker** (`yarn dev:worker` / `yarn worker`) — boots `server/indexer.ts`, registers cron schedules, dispatches each job into a worker thread. Owns all DB writes for `ibc_packets`, `ibc_daily_stats`, `prices`, `price_history`, `sync_cursors`.

Multi-chain: the `chains` table is the source of truth for chain slugs and metadata. Adding a chain = adding a row + a config entry in `server/tools/chains/params.ts` + one env var (`<CHAIN>_INDEXER_API_KEY`); the upstream URL lives in `server/tools/chains/params.ts`.

## Layout

```
chain-data-indexer/
├── AGENTS.md                this file
├── CLAUDE.md                @-imports AGENTS.md
├── Dockerfile.web           web image (multi-stage, non-root)
├── Dockerfile.worker        worker image (single-stage, runs `db:generate`)
├── docker-compose.yml       postgres + web + worker
├── .env.example             documented env template (commit this)
├── .env                     local secrets (gitignored)
├── docker/AGENTS.md         deployment / Docker docs (devops-owned)
├── prisma/                  schema, migrations, seed   → prisma/AGENTS.md
├── server/                  worker entry + jobs        → server/AGENTS.md
├── src/app/                 Next.js App Router         → src/app/AGENTS.md
│   └── api/                 v1 route handlers          → src/app/api/AGENTS.md
├── src/services/            DB-facing query services   → src/services/AGENTS.md
├── src/schemas/             Zod request/response shapes → src/schemas/AGENTS.md
├── src/components/          UI primitives + widgets    → src/components/AGENTS.md
├── src/lib/                 OpenAPI registry + api helpers → src/lib/AGENTS.md
└── src/utils/               pure shared helpers        → src/utils/AGENTS.md
```

## Module docs

| Path | Owner | What lives there |
|---|---|---|
| [`docker/AGENTS.md`](docker/AGENTS.md) | devops-dev | Dockerfile.web, Dockerfile.worker, docker-compose.yml, .env.example |
| [`prisma/AGENTS.md`](prisma/AGENTS.md) | db-worker-dev | schema, migrations, seed |
| [`server/AGENTS.md`](server/AGENTS.md) | db-worker-dev | worker entry, dispatcher, jobs, tools |
| [`src/app/AGENTS.md`](src/app/AGENTS.md) | frontend-dev | App Router pages, layouts, routing |
| [`src/app/api/AGENTS.md`](src/app/api/AGENTS.md) | api-dev | `/api/v1/*` route handlers |
| [`src/services/AGENTS.md`](src/services/AGENTS.md) | api-dev | stats / channels / assets / timeseries / transfers / health query layer |
| [`src/schemas/AGENTS.md`](src/schemas/AGENTS.md) | api-dev | Zod schemas + OpenAPI registration |
| [`src/components/AGENTS.md`](src/components/AGENTS.md) | frontend-dev | tables, cards, chart, nav, theme |
| [`src/lib/AGENTS.md`](src/lib/AGENTS.md) | api-dev | OpenAPI registry, patched Zod, route-handler helpers |
| [`src/utils/AGENTS.md`](src/utils/AGENTS.md) | frontend-dev | pure helpers (`cn`, `format-amount`, `format-denom`, `format-time`) |

## How to run

### Local dev (host Postgres + host Node)

```bash
docker compose up -d postgres        # only the DB, on :5432
yarn install
yarn db:deploy                       # apply migrations + seed assets
yarn dev:worker                      # background: cron + jobs (tsx watch)
yarn dev                             # foreground: Next dev on :3000
```

Set `DATABASE_URL=postgres://app:app@localhost:5432/crosschain` in `.env` for host-side Prisma; compose-side services use `…@postgres:5432/…`.

### Production-shaped (compose)

```bash
docker compose up -d --build         # postgres → migrations (one-shot) → web + worker
```

The `migrations` service runs `yarn db:deploy && yarn db:seed` once and exits. `web` and `worker` gate on it via `service_completed_successfully`, so no manual migration step is required.

`web` listens on `:${PORT}` (default `3000`). `worker` runs cron and writes to the DB; it has no public port.

### Useful scripts (from `package.json`)

| Script | What it does |
|---|---|
| `yarn dev` / `yarn dev:web` | Next dev server (Turbopack) |
| `yarn dev:worker` | `tsx watch server/indexer.ts` — auto-restart on changes |
| `yarn worker` | `tsx server/indexer.ts` — non-watch, for prod-shaped runs |
| `yarn build` | `next build` (standalone output) |
| `yarn start` | `next start` against the built app |
| `yarn db:migrate` | `prisma migrate dev` (interactive, dev only) |
| `yarn db:deploy` | `prisma migrate deploy` (non-interactive, prod-safe) |
| `yarn db:generate` | regenerate `@prisma/client` |
| `yarn db:seed` | `tsx prisma/seed.ts` (idempotent — assets only) |
| `yarn lint` | `eslint` flat-config run |

## Environment variables

The contract is in `.env.example`. Source of truth — keep that file and this table in sync.

| Var | Consumed by | Purpose |
|---|---|---|
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | `postgres` service in compose | DB bootstrap |
| `DATABASE_URL` | `web` + `worker` (Prisma + `pg`) | Connection string. `@postgres:5432` in compose, `@localhost:5432` on host |
| `COSMOSHUB_INDEXER_API_KEY` | `worker` only | Bearer-style key for the Cosmos Hub upstream. **Never exposed to `web`.** |
| `ATOMONE_INDEXER_API_KEY` | `worker` only | Bearer-style key for the AtomOne upstream. **Never exposed to `web`.** |
| `COINGECKO_API_KEY` | `worker` only | Optional. Empty falls back to the public free tier |
| `LOG_LEVEL` | `web` + `worker` | `pino` level (default `info`) |
| `PORT` | `web` host port | Defaults to `3000` |

Never commit `.env` (gitignored). Never log API keys.

## Conventions

- **TypeScript strict.** Path alias `@/*` → `./src/*`. `tsconfig.json` is the source of truth.
- **No ad-hoc SQL outside the worker / services layer.** API route handlers call into `src/services/*`, which are the only modules allowed to compose raw SQL via Prisma's `$queryRaw` / `$executeRaw`.
- **Money / bigint stays as strings** in JSON payloads (Cosmos amounts overflow JS `number`). The Zod response schemas enforce string types.
- **Time** — `event_time` is `timestamptz`. Aggregations happen in UTC: `(event_time AT TIME ZONE 'UTC')::date`.
- **Null denoms** — packets where ICS-20 decoding fails arrive with `denom IS NULL`. The recompute job coalesces these to `'__unknown__'` so they don't collide with rollup rows under `NULLS NOT DISTINCT` PKs.
- **Working docs** under `docs/plans/*-design.md` and `docs/plans/*-tasks.md` are intentionally untracked. Module `AGENTS.md` files (this one and the per-module ones) are tracked.

---

## ClawMem — Semantic Code Memory

> ⚠️ Not indexed yet. Add to `~/.config/clawmem/index.yml` to enable.

**When indexed:** use `memory_retrieve` MCP tool before code searches and `reindex` after each commit.
