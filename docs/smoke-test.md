# Smoke Test — Task 26

Date: 2026-05-15 (Asia/Bangkok)
Branch: `indexer-ibc-api`
Upstream: `https://indexer.cosmoshub-4.citizenweb3.com/api/v1`
Last `worker` commit at start: `75a93105` (fix for NULL-denom recompute collision)

## Setup

1. `docker compose up -d postgres` — Postgres 16 healthy.
2. `yarn db:deploy` — migrations applied (assets seed populated: ATOM/cosmos/6/uatom).
3. Truncated `ibc_packets`, `ibc_daily_stats`, `prices`, `price_history`, `sync_cursors` to start from a clean slate (kept `assets`).
4. `.env` set to real upstream URL + API key.
5. `yarn dev:worker` started → cron jobs registered.
6. `yarn dev` started after backfill → Next.js 16.2.6 (Turbopack) ready in 300ms.

## Worker results (after fix `75a93105`)

| Job | First run | Steady state |
|---|---|---|
| `sync-ibc-transfers` | new=50000, pagesFetched=500, elapsedMs=352 600 (backfill capped at MAX_PAGES) | new=11–31 per 5-min tick, 1 page each |
| `recompute-daily-stats` | rowsAffected=0 (ran 57 ms after worker start, before sync inserted rows) | rowsAffected=1049–1062 per tick, ~150–260 ms |
| `prices` | inserted=1 (CoinGecko ATOM USD), elapsedMs ≈ 500 | inserted=1 per 5-min tick |
| `price-history` | 364 ATOM points, elapsedMs=3062 | next run @ 00:00 cron |

No errors after the fix; `recompute-daily-stats` previously crashed with `21000 ON CONFLICT DO UPDATE command cannot affect row a second time` due to NULL-denom packets colliding with rollup rows under `NULLS NOT DISTINCT` PK. Fix coalesces NULL → `'__unknown__'` sentinel in CTE.

## DB state at end of smoke

```
packets:        50 119
packets_3d:     19 007
daily_stats:     1 064 rows
channels:           54 distinct (channel_id_src IS NOT NULL)
prices:             10
price_history:     364
sync_cursors:        1 (key=ibc-transfers, watermark @ height 31 127 029)
```

## API endpoints

| Endpoint | HTTP | Latency | Notes |
|---|---|---|---|
| `GET /api/v1/health` | 200 | 235 ms | db_ready=true; last_synced_height=31127029 |
| `GET /api/v1/stats?period=24h` | 200 | 499 ms | 24h: 4 722 transfers / 173 088.10 ATOM / $95 319.08 |
| `GET /api/v1/channels?period=24h&limit=10` | 200 | 474 ms | 10 channels, channel-0 (consumer) top by transfers (1 951) |
| `GET /api/v1/timeseries?period=7d&metric=transfers` | 200 | 32 ms | 30 daily points; older days `value=0` (sync covers ≈10 d) |
| `GET /api/v1/transfers?limit=10` | 200 | 94 ms | latest channel-141 uatom outgoing |
| `GET /api/openapi.json` | 200 | 32 ms | served |
| `GET /docs` | 200 | 116 ms | Scalar UI, title "API Docs — Crosschain IBC Indexer" |

Notable: `/timeseries` returned 400 when called without `metric` query param — design requires `metric=transfers|volume_atom|volume_usd`. After supplying it, 200.

## RSC pages

| Page | HTTP | Latency | Notes |
|---|---|---|---|
| `GET /` | 307 → `/dashboard` | 56 ms | redirect to dashboard |
| `GET /dashboard` (followed) | 200 | 560 ms | rendered real channels (channel-0/1/3/15/141/207/251/339/494/569/632/1265/1344/1351/1862) and formatted numbers `19,020`, `1,141,968`, `2,114,242` |
| `GET /channels/channel-0?port=consumer` | 200 | 900 ms | channel detail loaded |
| `GET /transfers` | 200 | 84 ms | transfers listing |
| `GET /transfers/transfer/channel-141/4917445` | 200 | 278 ms | transfer detail loaded |

No `error`/`warn`/`fail` entries in `/tmp/web.log` after startup.

## Design §13 checklist

- [x] All worker jobs run without crashes
- [x] `sync-ibc-transfers` populates `ibc_packets` with real cosmos-hub data
- [x] `recompute-daily-stats` produces non-zero `ibc_daily_stats` rows (1 049–1 062)
- [x] `prices` + `price-history` populate CoinGecko data
- [x] All 5 v1 API endpoints respond 200 on canonical params
- [x] `/api/openapi.json` + `/docs` serve OpenAPI spec
- [x] RSC pages render real data

## Acceptance (team-lead's 5 steps)

1. ✅ `docker compose up -d postgres` + `yarn db:deploy` + `yarn db:seed` (seed already done by `db:deploy`)
2. ✅ Per-chain `<CHAIN>_INDEXER_API_KEY` set for each chain (`COSMOSHUB_INDEXER_API_KEY`, `ATOMONE_INDEXER_API_KEY`)
3. ✅ `yarn dev:worker` — cron triggers fire on schedule
4. ✅ `yarn dev` — RSC pages serve
5. ✅ `/api/v1/{stats,channels,timeseries,transfers,health}` + `/api/openapi.json` + `/docs` — all 200

## Open follow-ups (non-blocking)

- `last_synced_at` in `/api/v1/health` lags real time by the sync period (5 min) — by design.
- `volume_atom`/`volume_usd` in `/api/v1/channels` show `0` for non-ATOM channels (no asset mapping yet); only the ATOM-denominated subset gets values. Confirms `__unknown__` sentinel routing is working.
- `tsc --noEmit` not yet wired into `lint` script (frontend-dev suggestion) — optional follow-up.

## Verdict

Smoke passed. Task 26 ready to complete; Task 27 (module docs) unblocked.
