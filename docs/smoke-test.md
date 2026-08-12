# Smoke Test — Task 26

Status: historical Task 26 record. Its aggregate totals and pre-correction behavior are superseded by the Issue 633 S0 rollout addendum below; the original observations remain for audit history.

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

---

# Issue 633 S0 rollout addendum — delivered-only IBC aggregates

Date: 2026-08-11

## Human pre-deployment gate

- [ ] The rollout owner confirms the currently deployed source ref and that the S0 branch is based on the intended deployment line. Do not merge or deploy on an assumed ref.
- [ ] Capture the current `/api/v1/{stats,timeseries,assets,channels}` combined and per-chain responses for 24h/7d/30d, plus the current failed-ORAI reproduction rows, before changing the database.
- [ ] Confirm a current database backup and an application rollback artifact exist.

## Migration-first order

1. Pause the indexer worker so an old process cannot write while the new aggregate schema is being deployed.
2. Run `yarn db:deploy`. Migration `20260811053000_add_ibc_aggregate_coverage` adds nullable daily coverage columns and `ibc_aggregate_states`; it does not rewrite existing daily rows.
3. Deploy the application and worker from the exact same reviewed ref, then run `yarn db:generate` in the built artifact if generation is not part of the image build.
4. Start the worker. `recompute-daily-stats` sees aggregate version 2 missing/mismatched and atomically replaces every retained chain/date slice from delivered packets. Pre-retention rows remain untouched and therefore remain `legacy_unverified`.
5. Do not treat the rollout as corrected until every configured chain has version 2, a non-null `corrected_from` when retained packets exist, and a fresh `last_recomputed_at`.

```sql
SELECT chain, version, corrected_from, last_recomputed_at
FROM ibc_aggregate_states
ORDER BY chain;

SELECT chain, key, updated_at
FROM sync_cursors
WHERE key IN ('sync-ibc-transfers', 'recompute-daily-stats')
ORDER BY chain, key;
```

A chain with no retained packets may have version 0 and `corrected_from = NULL`; its successful sync/recompute heartbeats distinguish a fresh empty source from a stale source.

## API smoke matrix

All valid requests must return 200 and include `generated_at` plus per-chain `sources`. Corrected coverage must satisfy `eligible_packets = priced_packets + unpriced_packets`; mixed/legacy coverage must be null.

```bash
curl -fsS 'http://localhost:3000/api/v1/stats?breakdown=chain'
curl -fsS 'http://localhost:3000/api/v1/cosmoshub/stats'
curl -fsS 'http://localhost:3000/api/v1/timeseries?metric=volume_usd&from=2025-08-12&to=2026-08-11'
curl -fsS 'http://localhost:3000/api/v1/atomone/timeseries?metric=volume_native'
curl -fsS 'http://localhost:3000/api/v1/assets?period=30d'
curl -fsS 'http://localhost:3000/api/v1/cosmoshub/assets?period=30d'
curl -fsS 'http://localhost:3000/api/v1/channels?period=30d'
curl -fsS 'http://localhost:3000/api/v1/atomone/channels?period=30d&sort=volume_native'
```

These invalid cross-chain native comparisons must return 400; an unknown chain must return 404:

```bash
curl -sS -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/api/v1/timeseries?metric=volume_native'
curl -sS -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/api/v1/channels?sort=volume_native'
curl -sS -o /dev/null -w '%{http_code}\n' 'http://localhost:3000/api/v1/unknown/stats'
```

The `/api/v1/transfers` lifecycle log intentionally remains unfiltered and may still show `sent`, `timeout`, and `failed` packets.

## Independent delivered-row checks

Compare API counts against source rows using the exact successful lifecycle predicate, never a circulating-supply bound:

```sql
SELECT
  chain,
  COUNT(*) AS eligible_packets,
  COUNT(*) FILTER (WHERE amount IS NOT NULL) AS packets_with_amount
FROM ibc_packets
WHERE event_time >= NOW() - INTERVAL '24 hours'
  AND (
    (direction = 'outgoing' AND status = 'acknowledged')
    OR (direction = 'incoming' AND status = 'received')
  )
GROUP BY chain
ORDER BY chain;

SELECT chain, direction, status, resolve_base_denom(denom) AS denom,
       COUNT(*) AS packets, SUM(amount) AS raw_amount
FROM ibc_packets
WHERE resolve_base_denom(denom) = 'orai'
  AND event_time >= NOW() - INTERVAL '30 days'
GROUP BY chain, direction, status, resolve_base_denom(denom)
ORDER BY chain, direction, status;
```

The failed ORAI ladder must contribute zero to corrected stats, timeseries, assets, and channel USD totals. Acknowledged outgoing and received incoming fixtures contribute once. AtomOne `volume_native` must use `uatone`/ATONE; no combined native scalar exists. Deprecated `volume_atom` remains the v1 `uatom` compatibility field for one release.

## UI and OpenAPI checks

- [ ] Combined and chain dashboards show priced-packet coverage or an explicit mixed/legacy warning with correction boundaries.
- [ ] AtomOne native cards/channel columns say ATONE, not ATOM.
- [ ] `/api/openapi.json` has distinct combined/per-chain stats and channel schemas; only per-chain timeseries/channel queries accept `volume_native`.
- [ ] `volume_atom` fields and metric descriptions are marked deprecated compatibility behavior.
- [ ] Existing RSC pages still stream through their service calls and Suspense boundaries; there is no client-side API refetch.

## Rollback implications

- Application rollback is safe while the additive columns/table remain. The prior binary ignores them.
- Do not drop the migration during an incident. A down migration would destroy correction boundaries and coverage evidence.
- A completed version-2 rebuild has already corrected retained daily rows. Rolling back application code does not and should not restore unsuccessful packets to those rows.
- If the new worker fails mid-chain rebuild, the transaction rolls back the slice, coverage, state, and heartbeat together. Investigate and rerun; do not hand-edit partial aggregates.
- Record before/after API captures, aggregate-state rows, worker logs, deployed ref, and final human approval in the release ticket.
