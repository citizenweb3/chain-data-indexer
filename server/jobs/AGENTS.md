# server/jobs/

Each file exports a single `run<Job>()` function. The dispatcher in `../task-worker.ts` picks one based on `workerData.taskName`. All jobs are designed to be idempotent — cron is the retry mechanism, not in-job loops.

## Files

| File | Cron name | Purpose |
|------|-----------|---------|
| `sync-ibc-transfers.ts` | `sync-ibc-transfers` | Pull packets from upstream `indexer-ibc-api`, mirror into `ibc_packets` |
| `recompute-daily-stats.ts` | `recompute-daily-stats` | Atomically replace delivered-only daily slices with coverage at 4 GROUPING SETS levels |
| `get-prices.ts` | `prices` | CoinGecko spot prices for all assets |
| `get-price-history.ts` | `price-history` | CoinGecko 365-day daily price history backfill |

## `sync-ibc-transfers.ts`

Watermark-based incremental sync. The content watermark is `ibc_packets`: the job reads `MAX((eventHeight, sequence, channelIdSrc, portIdSrc))` from the mirror at the start of each run via `readLatestPacket()` (Prisma `findFirst` with the matching `orderBy`). `SyncCursor` is written only after packet and discovered-channel writes succeed, as an observability heartbeat and a copy of the latest tuple; it does not drive pagination or the stopping rule.

### Algorithm

```
latest      = readLatestPacket()            (4-tuple from ibc_packets, may be null)
earliest    = readEarliestEventTime()       (oldest event_time in mirror, may be null)
cutoff      = now - BACKFILL_DAYS (30 days)
windowComplete = (earliest != null) && (earliest <= cutoff)
                   // true once the mirror spans the full retention window

mode = windowComplete ? 'delta' : 'backfill'

fetch upstream /ibc/transfers newest-first, paginate via 4-tuple cursor:
  for each packet in page:
    if event_height == null:           skip          // upstream rarely emits these
    if event_time     < cutoff:        stop          // walked past the retention window
    if windowComplete && tuple <= latest: stop       // caught up to the head of the mirror
    upsert by PK (channelIdSrc, portIdSrc, sequence)
  if !has_more or no cursor:           stop

insert newly discovered channel placeholders

after packet and discovered-channel writes succeed:
  write SyncCursor heartbeat + latest tuple
```

Two stopping conditions matter:

- **`tuple <= latest`** is the steady-state stop — applied only after `windowComplete`. During the initial backfill the mirror's head shifts every page; pinning the stop to a moving target would terminate prematurely.
- **`event_time < cutoff`** is the backfill stop — caps how far back any single run will paginate, independent of the mirror state.

### Why a 4-tuple comparison, not just `(height, sequence)`

Multiple packets can share `(eventHeight, sequence)` if they belong to different channels/ports (rare, but valid). The upstream's keyset pagination uses the full 4-tuple `(before_height, before_sequence, before_channel, before_port)` (see `server/tools/upstream-types.ts:IbcTransferCursor`). `compareCursor` mirrors that ordering exactly, or the mirror would either miss packets or duplicate them on the boundary page.

### Why `findUnique` + `create`/`update`, not `upsert`

Pure `upsert` would give the right end state but doesn't tell us whether the row was new or updated. Splitting into pre-check + create/update gives accurate `{ new, updated }` counters in the log — useful for observability without a second query. This is a controlled performance tradeoff that we accept because the sync is rate-limited by upstream HTTP latency, not by Postgres.

### `event_height` nullability

Packets with status `sent` may have no block yet (`event_height = null`). The upstream usually filters these out, but defensively the job:
1. Skips them when iterating the response (`skippedCount++`).
2. Filters them out in `readLatestPacket` (`where: { eventHeight: { not: null } }`) — a null-height row cannot anchor a watermark because comparison is undefined.

### Acceptance behavior

- **First run on empty DB**: `latest = null`, `earliest = null`, `windowComplete = false`. Mode `backfill`. Paginates newest-first until `event_time < cutoff`. Typical: ~1300 pages, ~10 min, ~130k packets for a busy chain.
- **Second run within 60 s after a fully-backfilled mirror**: `windowComplete = true`, `latest` set. Page 0 first row equals the head → stop after 1 page, 0 new, 0 updated.
- **After `TRUNCATE ibc_packets`**: full re-backfill, all rows hit the create branch (since none exist yet). No PK duplicates because the upsert PK is `(channelIdSrc, portIdSrc, sequence)`.
- **Partial wipe (e.g. `DELETE FROM ibc_packets WHERE event_time < ...`)**: the next run sees a non-null `latest` matching the surviving newest row. Mode flips between `backfill` (if `earliest > cutoff`) and `delta` (if `earliest <= cutoff`) based on how the surviving rows align with the retention window.

### Constants

- `PAGE_SIZE = 100` — chosen to balance upstream load against round-trip count.
- `BACKFILL_DAYS = 30` — design doc §6.1. Same horizon that the upstream retains.

There is no `MAX_PAGES` ceiling — the `event_time < cutoff` stop bounds the walk in time, and the per-task watchdog in `indexer.ts` (`TASK_TIMEOUT_MS['sync-ibc-transfers'] = 30 min`) is the catch-all if the upstream ever streams without honoring the cutoff.

## `recompute-daily-stats.ts`

Builds `ibc_daily_stats` from delivered `ibc_packets`. A versioned per-chain `IbcAggregateState` triggers one retained-range bootstrap; steady state atomically replaces the last `RECOMPUTE_DAYS = 3` days.

### Structure

```sql
WITH base AS (
  -- acknowledged outgoing + received incoming packets only
  -- denom NULL coalesced to '__unknown__'
),
agg AS (
  SELECT ..., COUNT(*), SUM(amount), SUM(priced amount * usd / 10^decimals),
         eligible/priced/unpriced counts, unpriced denom set
  FROM base LEFT JOIN assets LEFT JOIN price_history
  GROUP BY GROUPING SETS (
    (date, channel, direction, denom),    -- L1: full detail
    (date, channel, direction),           -- L2: channel rollup over denoms
    (date, direction, denom),             -- L3: denom rollup over channels
    (date, direction)                     -- L4: global per direction
  )
)
inside one transaction:
  DELETE the chain/date slice
  INSERT the complete replacement from agg
  update IbcAggregateState + successful recompute heartbeat
```

### Why `COALESCE(denom, '__unknown__')`

Undecoded packets (status `sent`, or never decoded by upstream) have `denom = NULL`. Without coalesce, the L1 grouping set produces a row `(date, channel, direction, NULL)` that would collide on conflict with the L2 rollup row `(date, channel, direction, GROUPING(denom)=NULL)`. The `NULLS NOT DISTINCT` unique index on the conflict target treats them as the same key — Postgres rejects this as `command cannot affect row a second time` (SQLSTATE 21000).

Coalescing to a sentinel string lifts undecoded packets into their own dim slot — they get counted in their own L1 row (`denom = '__unknown__'`), and the rollup L2 (`denom = NULL` from GROUPING) is a distinct conflict key. No collision.

The sentinel is `'__unknown__'` — double-underscored on purpose so it cannot collide with a real `transfer` denom string from the wire (real denoms start with `u`, `ibc/`, `factory/`, etc.).

### Filter semantics in callers

The API services rely on these dim slots:
- `denom IS NULL` → rollup row over all denoms (used for `transfers_count` totals).
- `denom = 'uatom'` → ATOM-specific volume rows (used for `volume_atom` / `volume_usd`).
- `denom = '__unknown__'` → opaque slot, **not surfaced** by the API. The strict `denom = 'uatom'` filter excludes it from volumes; the `denom IS NULL` filter for counts uses rollup rows that already include undecoded packets in their counts.

If you add a new asset (say SCRT priced via CoinGecko), the unique index already disambiguates `(..., 'uscrt')` from rollup. No schema change required.

### Idempotency and stale-row removal

The job deletes and reinserts the complete chain/date slice in one transaction. Re-running it converges to the same values, and a grouping that disappears from source leaves no stale row. Aggregate correction state and heartbeat advance only if the replacement commits.

### Why `make_interval(days => 3)` instead of `'3 days'::interval`

The `RECOMPUTE_DAYS` constant is interpolated by Prisma as a parameterized integer. `make_interval(days => $1)` keeps the parameter typed; `(${RECOMPUTE_DAYS} || ' days')::interval` would force a string concat that mixes types. Both work, but `make_interval` is safer if anyone ever raises the constant by hand.

### Range

On aggregate version mismatch or a newly earlier retained packet, rebuild from the earliest packet date and record it as `corrected_from`. Otherwise start three UTC dates back, covering late status rewrites. Rows before `corrected_from` remain legacy because their packets no longer exist.

## `get-prices.ts`

CoinGecko `/api/v3/simple/price?ids=...&vs_currencies=usd`. Asset list from `getAllAssets()` (DB-driven, ~56 assets after seed). Append-only `INSERT INTO prices` — one row per asset per run. No rate-limit logic here — upstream is forgiving on `/simple/price` and a missed cycle is irrelevant (next 5-min run catches up).

### Ported from validatorinfo

Source: `validatorinfo/server/jobs/get-prices.ts`. Changes:
- `chainParamsArray.filter(c => c.coinGeckoId)` → `await getAllAssets()` (DB instead of static config).
- `db.chain.findFirst({...})` → asset is the loop variable; no extra lookup.
- `priceService.addPrice(chain, value)` → inlined `db.price.create(...)`.
- Field rename: `value` → `usd`.

## `get-price-history.ts`

CoinGecko `/api/v3/coins/{id}/market_chart?vs_currency=usd&days=365&interval=daily`. Writes `price_history` (one row per UTC day, per asset). Upserts by `(assetId, date)` compound PK inside a single `$transaction(...)`.

### Gap detection

Before fetching, the job reads:
- `lastDate` — newest `PriceHistory.date` for this asset.
- `firstPriceDate` — oldest `Price.createdAt` (UTC-floored to a date).

If `lastDate >= firstPriceDate` → no gap → return early. The semantic: `PriceHistory` is the historical archive, `Price` is the live tick stream; they meet at the join point. Once they overlap, no further history is needed.

### Retry/backoff

Inherited verbatim from validatorinfo's `get-price-history.ts`:
- `RETRIES = 5`
- `REQUEST_DELAY = 1500` ms between assets (rate-limit hygiene).
- `RETRY_DELAY = 5000` ms on non-200 non-429.
- `TOO_MANY_REQUESTS_DELAY = 60_000` ms on 429.

`@cosmjs/utils.sleep` from validatorinfo was replaced with a local inline `sleep` — we have no `@cosmjs/*` dep in this project.

### Why no `server/tools/upstream-client.ts` here

That client targets the IBC indexer upstream (header `x-api-key`, configured base URL). CoinGecko has different headers, a different base URL, a different retry policy, and a free-tier without auth. Sharing the client would add config branches without simplifying anything. Keep them separate.

## Conventions across jobs

- Top-level export: `const run<Name> = async (): Promise<void> => { ... }`. The dispatcher imports by name.
- Log start, finish, and structured counters: `{ new, updated, skipped, pagesFetched, elapsedMs }`. The `extra` field is auto-serialized by the pino logger.
- No `try/catch` at the function boundary — let errors bubble. The dispatcher catches them and exits the worker with code 2; the parent logs and resets `tasksRunning`.
- Constants at file top, snake-case enums avoided. Use plain `number` / `string` literals.
- No retries in-job for the IBC sync (the HTTP client retries); explicit retries for CoinGecko jobs because they have provider-specific 429 semantics.
