# server/

Worker process — cron-driven background jobs that fill the Postgres mirror. Runs separately from the Next.js web server. Entry point `server/indexer.ts`, invoked via `yarn worker` / the worker Docker target.

## Files

| File | Purpose |
|------|---------|
| `indexer.ts` | Entry point — `CronJob` (from the `cron` package) × `worker_threads.Worker` orchestration + per-task watchdog |
| `task-worker-bootstrap.mjs` | ESM bootstrap that loads `task-worker.ts` through `tsx/esm/api`'s `tsImport`. Worker threads do not inherit the parent's `--import tsx` flag, so the `.ts` entrypoint cannot be a `Worker` URL directly |
| `task-worker.ts` | Per-task dispatcher running inside each spawned worker thread |
| `logger.ts` | Re-exports `@/logger` so server code can `import logger from './logger'` |
| `jobs/` | One file per scheduled task — see `server/jobs/AGENTS.md` |
| `tools/` | Shared helpers (upstream HTTP client, assets accessor, wire DTOs) — see `server/tools/AGENTS.md` |

## Architecture

```
server/indexer.ts (parent process)
  ├─ CronJob × 4   ──────────► triggers spawnTask(name)
  ├─ tasksRunning map  ──────► anti-overlap guard
  ├─ TASK_TIMEOUT_MS   ──────► per-task watchdog (terminate hung worker)
  └─ spawnTask(name)
       └─ new Worker(./task-worker-bootstrap.mjs, { workerData: { taskName } })
            └─ tsImport('./task-worker.ts') (tsx/esm/api)
                 └─ task-worker.ts dispatches by taskName
                      └─ server/jobs/<task>.ts
```

The parent never touches Postgres or HTTP; it only schedules and supervises. Every job runs in a fresh worker thread so a crash isolates to that task.

## Cron schedule

| Task | Schedule | Reason |
|------|----------|--------|
| `sync-ibc-transfers` | `*/1 * * * *` | One-minute pull window. Delta runs finish in ~2 s; the 60 s cadence comfortably absorbs upstream slack |
| `recompute-daily-stats` | `1-59/5 * * * *` | Every 5 minutes, offset by 1 min so it runs **after** the sync of the same window, never before |
| `prices` | `*/5 * * * *` | Free CoinGecko tier — 1-2 rps budget across 5-min windows |
| `price-history` | `0 0 * * *` | Daily — backfills any UTC-day gap once per midnight |

`recompute-daily-stats` is intentionally offset rather than chained because both jobs are stateless; if the recompute starts a few seconds before fresh packets land, the next 5-min cycle catches them via the 3-day window the job covers. Sync at `*/1` means the dashboard "last sync" indicator drifts at most ~60 s.

### Per-task watchdog

`TASK_TIMEOUT_MS` in `indexer.ts` caps each worker's lifetime:

| Task | Timeout |
|------|---------|
| `sync-ibc-transfers` | 30 min (backfill page count can dominate cold-start) |
| `recompute-daily-stats` | 4 min |
| `prices` | 4 min |
| `price-history` | 30 min (per-asset CoinGecko fetches dominate; 56 assets × ~1.5 s/page) |

`setTimeout` fires `worker.terminate()`, which triggers `on('exit')` with non-zero code; the parent logs and resets `tasksRunning`. Watchdog is cleared on normal `exit` / `error`. Do **not** raise these limits without an explanation in this doc — a hang here means a real bug (deadlock, infinite paging, upstream blackhole) and should be investigated, not papered over.

## `tasksRunning` anti-overlap map

```ts
const tasksRunning: Record<string, boolean> = {};
```

Plain in-memory `Record`. If a cron fires for a task whose previous run is still active, the new fire is **dropped** (logged `already running, skipping`). Reset on `worker.on('exit')` and on `worker.on('error')`. No queue, no retry — the next cron tick is the retry.

This is the classic validatorinfo pattern. Do not replace it with a queue/lock in dev/single-instance mode. Postgres-level locks become necessary only if you scale the worker process horizontally; until then the in-memory map is correct.

## Worker thread pattern

```ts
new Worker(new URL('./task-worker-bootstrap.mjs', import.meta.url), {
  workerData: { taskName, chains: CHAIN_NAMES },
});
```

`chains` is the frozen slug list from `server/tools/chains/chains.ts` (derived from `CHAIN_PARAMS`). Every job that touches per-chain storage (`sync-ibc-transfers`, `recompute-daily-stats`) receives this array and iterates internally with per-chain `try/catch` — one bad chain does not block the others. CoinGecko-only jobs (`prices`, `price-history`) ignore it.

```js
// task-worker-bootstrap.mjs
import { tsImport } from 'tsx/esm/api';
await tsImport('./task-worker.ts', import.meta.url);
```

Worker threads do not inherit `--import` ESM loaders from the parent (only CommonJS `-r` hooks propagate). Passing `execArgv: ['--import', 'tsx']` does work, but is fragile across Node minor versions; the `tsImport` programmatic API is the supported path on Node 22 + tsx 4. The `.mjs` extension is required because worker threads load it before any loader is in place.

`workerData` is the only contract from parent to child. The child re-loads `dotenv/config` at top of `task-worker.ts` because worker threads do not inherit `process.env` mutations from parent (they get a snapshot at spawn time, but explicit re-load keeps the contract local).

## Chain registry

Chain config lives in `server/tools/chains/`:

- `params.ts` — `CHAIN_PARAMS: ChainParams[]` is the single source of truth for runtime chain config. Each entry binds a slug (`name`) to its display label, on-chain `chainId`, upstream base URL (literal string in source — no env read at module load), and the env-var name that holds its API key (`apiKeyEnv`). `getChainParams(name)` throws on unknown slugs.
- `chains.ts` — exports the slug list derived from `CHAIN_PARAMS` for ergonomic imports in dispatcher / job code.

Adding a chain: append an entry to `CHAIN_PARAMS` (including the upstream URL literal), add the row to `chains` (seed + migration), supply the `<CHAIN>_INDEXER_API_KEY` env var, restart the worker.

## Dispatcher (`task-worker.ts`)

Plain `switch (taskName)`. Each case awaits a single `run*` function from `server/jobs/`. On success: `parentPort?.postMessage(...)` then `process.exit(0)`. On failure: log error and `process.exit(2)`. The parent picks up the exit code via `worker.on('exit')`, clears the watchdog, and updates `tasksRunning`.

No retries inside the worker. Upstream retries are handled at the HTTP layer (`server/tools/upstream-client.ts`). Cron is the retry policy for job-level failures.

## Logger (`server/logger.ts`)

Two-line re-export of `@/logger`. The reason it exists: `server/jobs/*.ts` uses both `@/db` and a path-relative `./logger` import for symmetry; without this re-export every job file would either need a different alias depth or both `@/logger` imports and local imports mixed in. Existence of this file is intentional — do not delete it.

## Smoke / boot

`yarn worker` starts everything. Expected first ~5 lines:
```
Starting indexer server
registered cron sync-ibc-transfers @ */1 * * * *
registered cron recompute-daily-stats @ 1-59/5 * * * *
registered cron prices @ */5 * * * *
registered cron price-history @ 0 0 * * *
starting task sync-ibc-transfers   (initial run)
```

Initial run on boot is intentional — all four jobs fire once on startup (see the second `for (const task of tasks)` loop in `runServer`). Skipping it would leave stats stale for up to the schedule interval (24 h for `price-history`) after a restart.
