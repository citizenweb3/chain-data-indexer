# server/

Worker process — cron-driven background jobs that fill the Postgres mirror. Runs separately from the Next.js web server. Entry point `server/indexer.ts`, invoked via `yarn worker` / the worker Docker target.

## Files

| File | Purpose |
|------|---------|
| `indexer.ts` | Entry point — `CronJob` × `worker_threads.Worker` orchestration |
| `task-worker.ts` | Per-task dispatcher running inside each spawned worker thread |
| `logger.ts` | Re-exports `@/logger` so server code can `import logger from './logger'` |
| `jobs/` | One file per scheduled task — see `server/jobs/AGENTS.md` |
| `tools/` | Shared helpers (upstream HTTP client, assets accessor, wire DTOs) — see `server/tools/AGENTS.md` |

## Architecture

```
server/indexer.ts (parent process)
  ├─ CronJob × 4   ──────────► triggers spawnTask(name)
  ├─ tasksRunning map  ──────► anti-overlap guard
  └─ spawnTask(name)
       └─ new Worker(./task-worker.ts, { workerData: { taskName } })
            └─ task-worker.ts dispatches by taskName
                 └─ server/jobs/<task>.ts
```

The parent never touches Postgres or HTTP; it only schedules and supervises. Every job runs in a fresh worker thread so a crash isolates to that task.

## Cron schedule

| Task | Schedule | Reason |
|------|----------|--------|
| `sync-ibc-transfers` | `*/5 * * * *` | Five-minute pull window matches upstream block cadence headroom |
| `recompute-daily-stats` | `1-59/5 * * * *` | Offset by 1 min so it runs **after** the sync of the same window, never before |
| `prices` | `*/5 * * * *` | Free CoinGecko tier — 1-2 rps budget across 5-min windows |
| `price-history` | `0 0 * * *` | Daily — backfills any UTC-day gap once per midnight |

`recompute-daily-stats` is intentionally offset rather than chained because both jobs are stateless; if the recompute starts a few seconds before fresh packets land, the next 5-min cycle catches them via the 3-day window the job covers.

## `tasksRunning` anti-overlap map

```ts
const tasksRunning: Record<string, boolean> = {};
```

Plain in-memory `Record`. If a cron fires for a task whose previous run is still active, the new fire is **dropped** (logged `already running, skipping`). Reset on `worker.on('exit')` and on `worker.on('error')`. No queue, no retry — the next cron tick is the retry.

This is the classic validatorinfo pattern. Do not replace it with a queue/lock in dev/single-instance mode. Postgres-level locks become necessary only if you scale the worker process horizontally; until then the in-memory map is correct.

## Worker thread pattern

```ts
new Worker(new URL('./task-worker.ts', import.meta.url), {
  workerData: { taskName },
  execArgv: ['--import', 'tsx'],
});
```

The `--import tsx` flag is required because worker threads do not inherit the parent's tsx loader. Without it, `new Worker(... .ts)` fails with `ERR_UNKNOWN_FILE_EXTENSION`. This is preferred over the older ts-node + tsconfig-paths approach used by validatorinfo.

`workerData` is the only contract from parent to child. The child re-loads `dotenv/config` at top of `task-worker.ts` because worker threads do not inherit `process.env` mutations from parent (they get a snapshot at spawn time, but explicit re-load keeps the contract local).

## Dispatcher (`task-worker.ts`)

Plain `switch (taskName)`. Each case awaits a single `run*` function from `server/jobs/`. On success: `process.exit(0)`. On failure: log error and `process.exit(2)`. The parent picks up the exit code via `worker.on('exit')` and updates `tasksRunning`.

No retries inside the worker. Upstream retries are handled at the HTTP layer (`server/tools/upstream-client.ts`). Cron is the retry policy for job-level failures.

## Logger (`server/logger.ts`)

Two-line re-export of `@/logger`. The reason it exists: `server/jobs/*.ts` uses both `@/db` and a path-relative `./logger` import for symmetry; without this re-export every job file would either need a different alias depth or both `@/logger` imports and local imports mixed in. Existence of this file is intentional — do not delete it.

## Smoke / boot

`yarn worker` starts everything. Expected first ~3 lines:
```
Starting indexer server
registered cron sync-ibc-transfers @ */5 * * * *
... (3 more registered lines)
starting task sync-ibc-transfers   (initial run)
```

Initial run on boot is intentional. Skipping it would leave stats stale for up to the schedule interval (5 min) after a restart.
