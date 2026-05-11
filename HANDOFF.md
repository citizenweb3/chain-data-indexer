# Chain Data Indexer: Production Performance Handoff (2026-03-14)

## Context

Goal was to run CDI against Cosmos Hub archive RPC starting around height `9_000_000` and sustain high throughput.
Observed throughput in production degraded from ~50 blk/s down to ~20 blk/s on non-empty blocks, even with high
concurrency. A separate "fast" `.env` showed ~220 blk/s, but it turned out those heights were mostly empty blocks
(post-migration genesis), so it was not comparable to indexing from `9_000_000`.

## What We Learned

### 1) RPC is not the bottleneck (in the slow case)

Runner timings showed RPC fetch and tx decode were relatively small:
- `fetchBlock`/`fetchResults`: ~180-300ms
- `decode`: ~80-150ms
- `assemble`: ~200-600ms

Despite that, end-to-end rate was ~13-20 blk/s. This pointed to the sink (Postgres) gating progress.

### 2) The `[progress] rate` can be misleading during flush stalls

In `src/runner/syncRange.ts`, `processed` increments only when blocks flush in-order through the sink.
When Postgres performs a long `flushAll()` transaction, `processed` can stall while `elapsed` keeps increasing,
so `rate = processed / elapsed` appears to "degrade" even if the pipeline is simply blocked on a flush.

### 3) Postgres sink flush is the bottleneck

The Postgres sink logs a `flushed` line with a breakdown:
- `partitionsMs`: time spent in `ensureCorePartitions(...)`
- `insertsMs`: time spent inserting buffered rows
- `commitMs`: transaction commit time
- `tookMs`: total flush time

We saw flushes like:
- `blocks=791` in ~40s (`insertsMs` ~34s, `partitionsMs` ~5s) -> effective ceiling ~20 blk/s on that segment.
- With smaller batch thresholds (`blocks=200`), flush happened more frequently, but still took 11-22s each, and
  `partitionsMs` stayed ~3-5s per flush, which became pure overhead.

### 4) `PG_BATCH_*` is not the whole story (hidden flush triggers)

`src/sink/postgres.ts` buffers multiple entity types. Only some thresholds are configurable via env
(`blocks/txs/msgs/events/attrs`). Other buffers (e.g. `transfers`, staking, wasm, gov) have internal thresholds
defaulting around ~5000 rows and are not controlled via env today.

This means:
- Setting extreme `PG_BATCH_*` values can still lead to huge flushes (triggered by those other buffers).
- Tuning `PG_BATCH_BLOCKS` too small causes frequent flushes and amplifies partition/txn overhead.

### 5) `FLUSH_EVERY` does not control Postgres sink flushing

`FLUSH_EVERY` is used by stdout/file sinks. Postgres sink flush cadence is controlled by its own batch thresholds.

### 6) A hard RPC ceiling exists: `blocks/sec <= RPS / 2`

CDI does at least 2 RPC GETs per height: `/block` and `/block_results`. So `RPS` caps steady-state throughput
even if DB is fast enough.

### 7) Follow mode clamps concurrency

When the backfill finishes and `FOLLOW=true`, `src/runner/follow.ts` calls `syncRange` with
`concurrency: Math.min(opts.concurrency, 16)`. Expect throughput to drop in live follow mode.

### 8) `.env.production` loading depends on how you run

The app code only auto-loads `.env` from the current working directory (`src/config/dotenv.ts`).
When running via docker compose with `--env-file .env.production`, compose injects env vars into the container,
so `.env.production` is effectively used.

### 9) `.env` parsing and `#` in password

Many `.env` parsers treat `#` as a comment delimiter for unquoted values. Keep `PG_PASSWORD` quoted.

## What We Changed

### 1) Production config tuning

We iterated on `.env.production` multiple times. The key tradeoff:
- Too small batch thresholds -> frequent flush -> high `partitionsMs` overhead.
- Too large batch thresholds -> huge transactions -> high `insertsMs` and long stalls.

The current `.env.production` in this repo is tuned for `FIRST_BLOCK=9000000` and non-empty blocks:
- `CONCURRENCY=64`, `RPS=1000`, `RETRIES=5`
- `PG_BATCH_BLOCKS=1000`, `PG_BATCH_TXS=4000`, `PG_BATCH_MSGS=12000`, `PG_BATCH_EVENTS=60000`, `PG_BATCH_ATTRS=150000`
- `PG_POOL_SIZE=16`

### 2) Code change: avoid re-ensuring partitions every flush

Main observed overhead was `partitionsMs` (advisory lock + many `CREATE TABLE IF NOT EXISTS`).
`src/db/partitions.ts` creates partitions in 1,000,000 height steps. When indexing sequentially, repeatedly
re-running `ensureCorePartitions` inside the same 1M range is wasted work.

We changed `src/sink/postgres.ts` to cache which 1M "partition bases" have already been ensured during the
current process run, and skip repeated `ensureCorePartitions(...)` calls for already-covered ranges.

Expected outcome: after the first flush in a given 1M range, `partitionsMs` should drop close to 0 for
subsequent flushes (until the height crosses into the next 1M range).

## What We Are Still Bottlenecked By

After partition caching, the next likely bottleneck is `insertsMs` (disk/WAL/checkpoints/index maintenance).
If `insertsMs` remains dominant, the remaining levers are mainly Postgres configuration and schema/index costs,
not RPC or tx decoding.

## How To Verify / Diagnose

1. Watch indexer logs for `sink/postgres flushed`:
- If `partitionsMs` stays high on every flush at heights within the same 1M range, the partition caching
  change is not deployed or multiple indexers are contending on the advisory lock.
- If `insertsMs` dominates, focus on DB tuning.

2. Watch `runner/syncRange` timings:
- High `decode` suggests worker pool saturation.
- High `fetch*` suggests RPC bottlenecking.
- Low timings but low end-to-end blk/s suggests sink flush gating.

## Next Steps (Recommended)

1. Confirm the partition-caching change is in the running image (rebuild and redeploy).
2. If `insertsMs` dominates, tune Postgres for bulk ingest (WAL/checkpoints, `synchronous_commit`, etc.).
3. Optionally make Postgres sink thresholds configurable for the internal buffers (`transfers/stake/...`),
   so flushing can be controlled more precisely via env.

## Notes / Known Issue In Local Dev

Running `yarn typecheck` in this workspace failed with:
`TS5110: Option 'module' must be set to 'NodeNext' when option 'moduleResolution' is set to 'NodeNext'.`
This appears repo/tooling-related and was not addressed as part of the performance work.

