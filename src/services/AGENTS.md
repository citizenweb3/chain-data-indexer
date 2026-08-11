# src/services/

DB-touching read services for the API + RSC pages. Pure functions: take typed params, return typed DTOs. No HTTP concerns, no caching, no Zod validation here (that lives in `src/schemas` + route handlers).

## Files

| File | Backs |
|------|-------|
| `stats-service.ts` | `/api/v1/stats` + dashboard cards |
| `channels-service.ts` | `/api/v1/channels` + channel list pages |
| `assets-service.ts` | `/api/v1/assets` + `/assets` per-asset breakdown page + dashboard top-assets card |
| `timeseries-service.ts` | `/api/v1/timeseries` + chart.js series on dashboard / channel detail |
| `transfers-service.ts` | `/api/v1/transfers` + `/transfers/[port]/[channel]/[sequence]` |
| `health-service.ts` | `/api/v1/health` + dashboard last-sync card (`getSyncWatermark` — MAX `event_height` / `event_time` from `ibc_packets`) |
| `ibc-aggregation-sql.ts` | Canonical delivered lifecycle, resolved-denom, and priced-packet SQL fragments |
| `ibc-aggregation-coverage.ts` | Pure coverage merging, invariant checks, and public DTO conversion |

## Imports

- `db` singleton from `@/db` (Prisma 7 driver adapter). Never instantiate `PrismaClient` here.
- `Prisma` from `@prisma/client` for `Prisma.sql` / `Prisma.join` / `Prisma.empty` / `Prisma.Decimal`.
- `formatNative` from `@/utils/format-amount` for `Decimal -> human ATOM string` formatting (6 decimals).
- `IbcTransferDto` type from `../../server/tools/upstream-types` for transfer payloads. The cross-tree import is intentional — the wire shape is defined once for the worker and reused by the API to avoid drift.

## Services are imported directly into RSC pages, never via HTTP

```ts
// src/app/dashboard/page.tsx
import { getStats } from '@/services/stats-service';
const data = await getStats({ direction: 'both' });
```

The `/api/v1/*` route handlers and the RSC pages share the same service functions. Do **not** add a `fetch('/api/v1/...')` from a server component — it doubles latency, breaks Next 16 cache hints, and obscures the call graph.

When you need request-scoped overrides (caching keys, etc.), pass them as args, do not branch on `process.env` or `request` inside the service.

## Hybrid 24h / daily-rollup query strategy

This is the single most important pattern. Read it before touching any service.

The DB has two layers:
- `ibc_packets` — exact per-packet rows. Used for "today" / "last 24h" windows where minute-level accuracy matters and volume is bounded by the 30d retention window.
- `ibc_daily_stats` — pre-aggregated rollup written by `recompute-daily-stats` cron (see `server/jobs/AGENTS.md`). Used for 7d / 30d windows where scanning packets would be prohibitive.

**Rule:** for a multi-window endpoint (stats, channels), compute each window from the cheapest source that gives the correct answer:

| Window | Source | Reason |
|--------|--------|--------|
| 24h (rolling, `now - 24h`) | `ibc_packets` directly | Daily rollup buckets by UTC date, cannot answer rolling-window |
| 7d / 30d (UTC-day aligned, `[midnight-Nd, midnight)`) | `ibc_daily_stats` | Pre-aggregated rollup |
| Today (`[midnight, now)`) | `ibc_packets` | Daily rollup may not yet include today; recompute lags by ~5 min |

`stats-service.ts` is the reference implementation:
- `queryPacketsWindow` for the 24h window AND for the "today" overlay
- `queryDailyWindow` for `[midnight-6d, midnight)` (7d) and `[midnight-29d, midnight)` (30d)
- Sum `today + daily_window` to get the final 7d/30d values

Do not query `ibc_packets` for a 30d count. The 30d retention boundary is upstream — older data lives only in `ibc_daily_stats`.

## `denom IS NULL` vs `denom = 'uatom'` in `ibc_daily_stats`

`ibc_daily_stats` is a 4-way `GROUPING SETS` pre-cube. Each row has a `denom` column that is either a real denom value or `NULL`, where `NULL` means "rolled up across all denoms":

- **Counts** (transfer counts): filter `WHERE denom IS NULL` — this is the rollup row that counts every packet regardless of denom, including packets with no denom at all.
- **Volumes** (volume_atom, volume_usd): filter `WHERE denom = 'uatom'` — volume only makes sense for a specific asset.

Mixing these up will either undercount transfers (by limiting to ATOM packets only) or accidentally double-count volume (by summing the rollup row that itself contains the ATOM sum).

See `stats-service.queryDailyWindow` and `timeseries-service.queryDailyStats` — both follow this rule.

Channel-level uses the same pattern with the extra column: `channel_id_src IS NOT NULL AND denom IS NULL` (channel-rollup row across denoms), or `channel_id_src IS NOT NULL AND denom = 'uatom'` (channel-specific ATOM volume).

For the global (cross-channel) rollup row, filter `channel_id_src IS NULL`.

## Counterparty chain enrichment

`channels-service.queryChannelsMeta` `LEFT JOIN`s `ibc_channels` on `(channel_id_src, port_id_src)` to surface `counterparty_chain_id` and `counterparty_chain_name` in the `ChannelDto`. The join is left-side: rows from `ibc_packets` without a matching `ibc_channels` row (newer channels, non-seeded ports like `icahost`) still appear in the API output with `null` chain fields — clients must tolerate that. The lookup never widens the result set because `(channel_id_src, port_id_src)` is the PK of `ibc_channels`.

## `DISTINCT ON` pattern for last-known `channel_id_dst`

In `channels-service.queryChannelsMeta`, the same `(channel_id_src, port_id_src)` pair may have appeared with different `channel_id_dst` values over its lifetime (or NULL during the `sent`-only phase). To pick the latest known destination:

```sql
SELECT DISTINCT ON (channel_id_src, port_id_src)
  channel_id_src, port_id_src, channel_id_dst, event_time
FROM recent
ORDER BY channel_id_src, port_id_src, event_time DESC NULLS LAST
```

`DISTINCT ON` is Postgres-specific. The `ORDER BY` columns must lead with the `DISTINCT ON` columns (Postgres planner requirement) then the tiebreaker. `NULLS LAST` prevents a never-finalized packet's NULL `event_time` from masking a real later observation.

## Keyset pagination (transfers list)

`transfers-service.listTransfers` uses a 4-tuple keyset cursor:

```sql
WHERE (event_height, sequence, channel_id_src, port_id_src) < (?, ?, ?, ?)
ORDER BY event_height DESC NULLS LAST, sequence DESC, channel_id_src DESC, port_id_src DESC
LIMIT n+1
```

Why 4-tuple, not just `(event_height, sequence)`:
- `sequence` is unique per `(channel_id_src, port_id_src)` not globally — two channels can ship sequence `42` in the same block.
- A height + sequence cursor would skip or duplicate rows when multiple channels collide.
- Adding the channel + port tail makes the tuple a total order.

The probe-limit pattern (`LIMIT n+1`) determines `has_more` without a separate count query. The exact total is fetched via a parallel `COUNT(*)` for the response envelope, but that count is **not** what drives pagination.

Cursor extraction: walk the page rows from the tail and pick the **last row that has a non-null `event_height`**. Rows with NULL `event_height` (transient `sent` packets) are sorted last by `NULLS LAST` but cannot anchor a cursor — they are inherently unstable.

If `before_*` is missing the page returns from the top; if any one of the four is missing the schema-layer `superRefine` rejects the request before it reaches the service.

## Decimal handling

All money-like values traverse the service as `Prisma.Decimal`, then get formatted at the boundary:
- ATOM amounts: `formatNative(value.toFixed(0), 6)` → human string with up to 6 fraction digits.
- USD amounts: `value.toFixed(2)`.

Never coerce `Prisma.Decimal` to JS `number` mid-pipeline. We use `.add()` on Decimal for inter-window sums (e.g. `today + daily`).

The `formatAtom` / `formatUsd` helpers are duplicated across services. That is acceptable — extracting would tangle the type aliases (different services have different domain types). If they ever diverge in behavior, that is a bug.

## When you add a new service

1. Take typed params (camelCase TS, even if URL params are snake_case — the route handler does the mapping).
2. Return a typed DTO that matches the Zod response schema (verify the `z.infer<typeof ...ResponseSchema>` aligns).
3. Use `db.$queryRaw<Row[]>(Prisma.sql\`...\`)` for any query touching `ibc_packets` or `ibc_daily_stats` directly — Prisma Client's typed API does not express the rollup filters cleanly.
4. Run any new SQL against a local seeded DB before commit. The cron-fed schema has subtle nullability (e.g. `event_time IS NOT NULL` filter is required when ordering by it).
