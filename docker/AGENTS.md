# docker / deployment

Documentation for the container build & orchestration layer. The files documented here live in the **repo root**, not in this directory — `docker/` exists only as a home for this `AGENTS.md` so the deployment story has a single owner.

Owner: devops-dev.

## Files in scope

| Path | What it is |
|---|---|
| `../Dockerfile.web` | Multi-stage image for the Next.js `web` process |
| `../Dockerfile.worker` | Single-stage image for the `tsx`-driven `worker` process |
| `../docker-compose.yml` | Local orchestration: `postgres` + `migrations` + `web` + `worker` |
| `../.dockerignore` | Build-context exclusions (node_modules, .next, .env*, .git, agent state, plan docs) |
| `../.env.example` | Documented env template — copy to `.env`, fill in secrets, never commit `.env` |

## Dockerfile.web — multi-stage Next standalone

Three stages on `node:22-alpine` (the base image is parameterised by the `NODE_VERSION` build arg, default `22-alpine`):

1. **`deps`** — installs dependencies from `package.json` + `yarn.lock` with `--frozen-lockfile`. `libc6-compat` is required for Prisma's native bindings on Alpine.
2. **`builder`** — copies the full source, runs `yarn build`. Next is configured with `output: 'standalone'` (see `next.config.ts`), which writes a self-contained `.next/standalone/` tree plus a separate `.next/static/` directory.
3. **`runner`** — non-root (`nextjs:nodejs`, uid/gid 1001). Copies only the standalone bundle, the static assets, and `public/`. Entrypoint is `node server.js` — there is **no `next start` in the runtime image** (the standalone bundle includes its own minimal server).

`NEXT_TELEMETRY_DISABLED=1` is set in both build and runtime stages. `EXPOSE 3000`, `HOSTNAME=0.0.0.0` so the standalone server binds outside the container.

To rebuild: `docker compose build web` (or `docker build -f Dockerfile.web .`).

## Dockerfile.worker — single-stage, tsx at runtime

Single stage on `node:22-alpine`. The worker runs TypeScript directly via `tsx` — no separate build step. The image:

1. Installs deps with `--frozen-lockfile`.
2. Copies `prisma/` and runs `yarn db:generate` so `@prisma/client` is materialized before boot.
3. Copies `tsconfig.json`, `server/`, and `src/` (the worker resolves `@/*` into `src/*` for shared types).
4. `CMD ["yarn", "worker"]` → `tsx server/indexer.ts`.

Worker threads spawn through `server/task-worker-bootstrap.mjs`, which loads `task-worker.ts` via `tsx/esm/api`'s `tsImport`. The bootstrap file must stay in the image — it is the only way to load a `.ts` worker entrypoint without the parent's `--import tsx` flag propagating (it doesn't).

No port exposed; the worker is a pure cron-driven side effect. It must share `DATABASE_URL` with `web`.

## docker-compose.yml

Four services. No `version:` key — compose v2 deprecated it.

### `postgres`

- Image `postgres:16-alpine`, restart `unless-stopped`.
- Volume `pgdata` mounted at `/var/lib/postgresql/data` (named volume, persists across `docker compose down`).
- Bound to `:5432` on the host so host-side `yarn db:migrate` / `yarn dev:worker` / `yarn dev` work without entering the container.
- Healthcheck via `pg_isready` (`5s/5s/10 retries`).

### `migrations`

- Built from `Dockerfile.worker` (reuses the worker image — it already has `@prisma/client`, `prisma` CLI, `tsx`, and `prisma/seed.ts` baked in).
- Env: `DATABASE_URL` only.
- `command: sh -c "yarn db:deploy && yarn db:seed"` — applies pending migrations, then runs the idempotent seed (assets upsert).
- `restart: "no"` — one-shot. Exits 0 on success; web/worker gate on `service_completed_successfully`.
- Depends on `postgres` healthy.

### `web`

- Built from `Dockerfile.web`.
- Env: `DATABASE_URL`, `LOG_LEVEL`, `PORT` (only — `UPSTREAM_*` and `COINGECKO_API_KEY` are intentionally **not** passed so the public surface never sees secrets).
- Port mapping `${PORT}:3000` (defaults to `3000:3000`).
- `depends_on`: `postgres` healthy **and** `migrations` completed successfully — won't accept traffic against a schema that hasn't caught up.

### `worker`

- Built from `Dockerfile.worker`.
- Env: everything the jobs need — `DATABASE_URL`, `UPSTREAM_INDEXER_BASE_URL`, `UPSTREAM_INDEXER_API_KEY`, `COINGECKO_API_KEY`, `LOG_LEVEL`.
- No published ports.
- Same gate as `web`: healthy DB + migrations complete.

### `pgdata` volume

Named volume only — there's no bind mount. To wipe local DB state: `docker compose down -v`.

## .env.example contract

Keep this file in sync with the env table in the [top-level `AGENTS.md`](../AGENTS.md#environment-variables) and with every `process.env.*` reference in `server/`, `src/services/`, and Prisma config. When you add or rename a var:

1. Update `.env.example` with a placeholder and a one-line comment explaining purpose.
2. Update the top-level `AGENTS.md` env table.
3. If the var is consumed by a container, add it to the matching `environment:` block in `docker-compose.yml`.
4. **Never** put real secrets in `.env.example`. The committed `UPSTREAM_INDEXER_API_KEY=replace-me` is intentional.

`.env` is gitignored; the `!.env.example` exception in `.gitignore` keeps the template tracked.

## .dockerignore

Excludes:
- `node_modules`, `.next`, `dist`, `build` — produced inside the image
- `.git`, `.idea`, `.vscode`, `.claude`, `.gitnexus` — host-only state
- `.env*` (all env files) — secrets stay on the host
- `docs/plans/*-design.md`, `docs/plans/*-tasks.md` — untracked working docs, no reason to ship
- Logs, `*.log`, `tsconfig.tsbuildinfo`

Adding to this list shrinks the build context and speeds up `COPY . .` in the builder stage. When adding a new top-level artifact, decide whether it belongs in the image — if not, add it here.

## Running tips

- **First-time bring-up / redeploy**: `docker compose up -d --build`. Compose waits for `postgres` healthy, runs `migrations` to completion, then starts `web` and `worker`. No manual `yarn db:deploy` step.
- **Schema changes on deployed envs**: ship a new image with the migration in `prisma/migrations/`. `migrations` service re-runs on `docker compose up`; `prisma migrate deploy` is idempotent — already-applied migrations are skipped.
- **Force a re-seed only**: `docker compose run --rm migrations yarn db:seed`.
- **Logs**: `docker compose logs -f worker` for cron output, `docker compose logs -f web` for HTTP, `docker compose logs migrations` for the one-shot run.
- **Reset DB only**: `docker compose down postgres && docker volume rm chain-data-indexer_pgdata && docker compose up -d`. Migrations service will re-apply everything against the fresh volume.
- **Wipe everything**: `docker compose down -v --rmi local`.

## Things to be careful about

- The `worker` image installs prod + dev deps because `tsx` is a runtime dep here. If you ever move worker code through a build step, switch the install to `--production` and copy compiled output instead.
- `next.config.ts` must keep `output: 'standalone'` or `Dockerfile.web`'s runner stage will be empty.
- `/api/v1/health` returns 200 with `db_ready: true` + `last_synced_at/_height` (null when `ibc_packets` is empty) on success, 500 on DB error. A healthcheck that requires `last_synced_at != null` is fine on warm envs but will flap during the first backfill — keep the gate as `docker compose` service ordering (`migrations` → `web`/`worker`) and reserve health probes for liveness, not readiness, until you wire a SLO around watermark freshness.
- yarn 1.22 has quirks parsing `@latest` in binary names; stick to pinned versions in `package.json`.
