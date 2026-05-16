# server/jobs/

Each file exports a single `run<Job>()` function. The dispatcher in `../task-worker.ts` picks one based on `workerData.taskName`. All jobs are designed to be idempotent — cron is the retry mechanism, not in-job loops.

## Files

| File | Cron name | Purpose |
|------|-----------|---------|
| `sync-ibc-transfers.ts` | `sync-ibc-transfers` | Pull packets from upstream `indexer-ibc-api`, mirror into `ibc_packets` |
| `recompute-daily-stats.ts` | `recompute-daily-stats` | Aggregate the last 3 days into `ibc_daily_stats` with 4 GROUPING SETS levels |
| `get-prices.ts` | `prices` | CoinGecko spot prices for all assets |
| `get-price-history.ts` | `price-history` | CoinGecko 365-day daily price history backfill |

## `sync-ibc-transfers.ts`

Watermark-based incremental sync. Single source of truth: `SyncCursor[key='ibc-transfers']`.

### Algorithm

```
watermark = SyncCursor.ibc-transfers   (4-tuple, may be null)
fetch upstream /ibc/transfers newest-first, paginate via cursor
remember newest tuple from page 0 → new watermark candidate
for each packet in stream:
  if watermark != null and (eventHeight, sequence, channel, port) <= watermark: stop
  if watermark == null and event_time < now - 30d: stop (initial backfill cutoff)
  upsert by PK (channelIdSrc, portIdSrc, sequence)
commit new watermark
```

### Why a 4-tuple watermark, not just `(height, sequence)`

Multiple packets can share `(eventHeight, sequence)` if they belong to different channels/ports (rare, but valid). The upstream's keyset pagination uses the full 4-tuple `(before_height, before_sequence, before_channel, before_port)` (see `server/tools/upstream-types.ts:IbcTransferCursor`). The sync mirror has to compare on the same 4-tuple or it can either miss packets or duplicate them on the boundary page.

### Why `findUnique` + `create`/`update`, not `upsert`

Pure `upsert` would give the right end state but doesn't tell us whether the row was new or updated. Splitting into pre-check + create/update gives accurate `{ new, updated }` counters in the log — useful for observability without a second query. This is a controlled performance tradeoff that we accept because the sync is rate-limited by upstream HTTP latency, not by Postgres.

### Watermark caveat: `event_height` nullability

Packets with status `sent` may have no block yet (`event_height = null`). The upstream filters these out of the listing (`WHERE event_height IS NOT NULL` in upstream SQL), so the mirror never sees them. The watermark candidate code defensively skips any null-height row found on page 0 — see `nextWatermark` assignment.

### Acceptance behavior

- First run with empty `SyncCursor`: backfills 30 days, commits the newest tuple as watermark.
- Second run within 5 min: page 0 first row equals the watermark → stop immediately, 1 page fetched, 0 inserts.
- After `DELETE FROM sync_cursors WHERE key='ibc-transfers'`: full re-backfill, all rows hit the upsert update branch (`updated` counter goes up), no PK duplicates because the upsert PK is `(channelIdSrc, portIdSrc, sequence)`.

### Constants

- `PAGE_SIZE = 100` — chosen to balance upstream load against round-trip count.
- `MAX_PAGES = 500` — hard ceiling. Protects against a runaway loop if the watermark check ever malfunctions; at 100 rows/page this caps a single run at 50k packets. Hit this and you should investigate, not raise the limit.
- `BACKFILL_DAYS = 30` — design doc §6.1.

## `recompute-daily-stats.ts`

Single raw SQL via `db.$executeRaw`. Builds `ibc_daily_stats` from `ibc_packets` for the last `RECOMPUTE_DAYS = 3` days.

### Structure

```sql
WITH base AS (
  -- packets from last 3 days, denom NULL coalesced to '__unknown__'
),
agg AS (
  SELECT ..., COUNT(*), SUM(amount), SUM(amount * usd / 10^decimals)
  FROM base LEFT JOIN assets LEFT JOIN price_history
  GROUP BY GROUPING SETS (
    (date, channel, direction, denom),    -- L1: full detail
    (date, channel, direction),           -- L2: channel rollup over denoms
    (date, direction, denom),             -- L3: denom rollup over channels
    (date, direction)                     -- L4: global per direction
  )
)
INSERT INTO ibc_daily_stats SELECT ... FROM agg
ON CONFLICT (date, channel_id_src, direction, denom) DO UPDATE SET ...
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

### Idempotency

The `ON CONFLICT ... DO UPDATE` sets every non-key column from `EXCLUDED`. Re-running the job replaces values; the row count of `ibc_daily_stats` stays stable across runs within the 3-day window.

### Why `make_interval(days => 3)` instead of `'3 days'::interval`

The `RECOMPUTE_DAYS` constant is interpolated by Prisma as a parameterized integer. `make_interval(days => $1)` keeps the parameter typed; `(${RECOMPUTE_DAYS} || ' days')::interval` would force a string concat that mixes types. Both work, but `make_interval` is safer if anyone ever raises the constant by hand.

### Range

Three days back from `NOW()`. This covers late-arriving packets that the upstream rewrote (e.g., a `sent` packet that later got its `acknowledged` event). The window is not tunable per-call — change `RECOMPUTE_DAYS` if needed.

## `get-prices.ts`

CoinGecko `/api/v3/simple/price?ids=...&vs_currencies=usd`. Asset list from `getAllAssets()` (DB-driven, currently just ATOM). Append-only `INSERT INTO prices`. No rate-limit logic here — upstream is forgiving on `/simple/price` and a missed cycle is irrelevant (next 5-min run catches up).

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
