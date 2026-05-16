# docker / deployment

Documentation for the container build & orchestration layer. The files documented here live in the **repo root**, not in this directory — `docker/` exists only as a home for this `AGENTS.md` so the deployment story has a single owner.

Owner: devops-dev.

## Files in scope

| Path | What it is |
|---|---|
| `../Dockerfile.web` | Multi-stage image for the Next.js `web` process |
| `../Dockerfile.worker` | Single-stage image for the `tsx`-driven `worker` process |
| `../docker-compose.yml` | Local orchestration: `postgres` + `web` + `worker` |
| `../.dockerignore` | Build-context exclusions (node_modules, .next, .env*, .git, agent state, plan docs) |
| `../.env.example` | Documented env template — copy to `.env`, fill in secrets, never commit `.env` |

## Dockerfile.web — multi-stage Next standalone

Three stages on `node:20-alpine`:

1. **`deps`** — installs dependencies from `package.json` + `yarn.lock` with `--frozen-lockfile`. `libc6-compat` is required for Prisma's native bindings on Alpine.
2. **`builder`** — copies the full source, runs `yarn build`. Next is configured with `output: 'standalone'` (see `next.config.ts`), which writes a self-contained `.next/standalone/` tree plus a separate `.next/static/` directory.
3. **`runner`** — non-root (`nextjs:nodejs`, uid/gid 1001). Copies only the standalone bundle, the static assets, and `public/`. Entrypoint is `node server.js` — there is **no `next start` in the runtime image** (the standalone bundle includes its own minimal server).

`NEXT_TELEMETRY_DISABLED=1` is set in both build and runtime stages. `EXPOSE 3000`, `HOSTNAME=0.0.0.0` so the standalone server binds outside the container.

To rebuild: `docker compose build web` (or `docker build -f Dockerfile.web .`).

## Dockerfile.worker — single-stage, tsx at runtime

The worker runs TypeScript directly via `tsx` — no separate build step. The image:

1. Installs deps with `--frozen-lockfile`.
2. Copies `prisma/` and runs `yarn db:generate` so `@prisma/client` is materialized before boot.
3. Copies `tsconfig.json`, `server/`, and `src/` (the worker resolves `@/*` into `src/*` for shared types).
4. `CMD ["yarn", "worker"]` → `tsx server/indexer.ts`.

No port exposed; the worker is a pure cron-driven side effect. It must share `DATABASE_URL` with `web`.

## docker-compose.yml

Three services. No `version:` key — compose v2 deprecated it.

### `postgres`

- Image `postgres:16-alpine`, restart `unless-stopped`.
- Volume `pgdata` mounted at `/var/lib/postgresql/data` (named volume, persists across `docker compose down`).
- Bound to `:5432` on the host so host-side `yarn db:migrate` / `yarn dev:worker` / `yarn dev` work without entering the container.
- Healthcheck via `pg_isready` (`5s/5s/10 retries`).

### `web`

- Built from `Dockerfile.web`.
- Env: `DATABASE_URL`, `LOG_LEVEL`, `PORT` (only — `UPSTREAM_*` and `COINGECKO_API_KEY` are intentionally **not** passed so the public surface never sees secrets).
- Port mapping `${PORT}:3000` (defaults to `3000:3000`).
- `depends_on: postgres: condition: service_healthy` — won't start until DB accepts connections.

### `worker`

- Built from `Dockerfile.worker`.
- Env: everything the jobs need — `DATABASE_URL`, `UPSTREAM_INDEXER_BASE_URL`, `UPSTREAM_INDEXER_API_KEY`, `COINGECKO_API_KEY`, `LOG_LEVEL`.
- No published ports.
- Same healthy-DB gate.

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

- **First-time bring-up**: `docker compose up -d postgres` → wait for healthy → `yarn db:deploy` (host) → `docker compose up -d web worker`.
- **Migrations in deployed envs**: run `docker compose exec web yarn db:deploy` (web has Prisma CLI). Don't bake `migrate deploy` into the Dockerfile — that would couple image rollout to schema state.
- **Logs**: `docker compose logs -f worker` for cron output, `docker compose logs -f web` for HTTP.
- **Reset DB only**: `docker compose down postgres && docker volume rm chain-data-indexer_pgdata && docker compose up -d postgres`. Re-run migrations.
- **Wipe everything**: `docker compose down -v --rmi local`.

## Things to be careful about

- The `worker` image installs prod + dev deps because `tsx` is a runtime dep here. If you ever move worker code through a build step, switch the install to `--production` and copy compiled output instead.
- `next.config.ts` must keep `output: 'standalone'` or `Dockerfile.web`'s runner stage will be empty.
- Don't add a healthcheck to `web` that hits `/api/v1/health` until after migrations have run — fresh DB returns `db_ready: false` and would flap restart.
- yarn 1.22 has quirks parsing `@latest` in binary names; stick to pinned versions in `package.json`.
