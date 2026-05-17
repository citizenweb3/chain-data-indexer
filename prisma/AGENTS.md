# prisma/

Prisma schema, migrations, and seed for the meta-indexer Postgres.

## Files

| File | Purpose |
|------|---------|
| `schema.prisma` | 6 models — `IbcPacket`, `Asset`, `Price`, `PriceHistory`, `IbcDailyStats`, `SyncCursor` |
| `migrations/20260515075735_init/migration.sql` | Initial DDL — includes hand-patched `NULLS NOT DISTINCT` index |
| `seed.ts` | Idempotent upsert of ~56 assets across Cosmos-native, ERC-20 bridge (gravity/axelar/noble), and liquid-staking variants (see `ASSETS` array at the top of the file) |

`prisma.config.ts` lives in the repo root, **not here**. Prisma 7 mandates it (replaces `datasource.url` in the schema). It loads `DATABASE_URL` via `dotenv/config` and wires the `prisma/seed.ts` runner. Touch it if migration paths or seed command change.

## Models

`IbcPacket` — local mirror of upstream `/api/v1/ibc/transfers`. PK `(channelIdSrc, portIdSrc, sequence)`. Nullable `event_height` / `event_time` for transient `sent` packets that have no block yet. `amount: Decimal(80, 0)` matches upstream `NUMERIC(80,0)` — never coerce to JS `number`.

`Asset` — coingecko-priced asset registry. `nativeDenom` is unique (used by `getAssetByDenom`). Seeded with ~56 assets — see `seed.ts` `ASSETS` constant. The seed is idempotent (upsert by `nativeDenom`), so re-running it after adding a row only inserts the new one.

`Price` — point-in-time spot prices written by the `prices` cron (every 5 min). Append-only; no upsert.

`PriceHistory` — daily closing prices from CoinGecko `market_chart`. PK `(assetId, date)`. Upsert by compound PK.

`IbcDailyStats` — pre-aggregated rollup for the API stats/channels/timeseries services. Pre-cube of 4 `GROUPING SETS` levels; see `server/jobs/AGENTS.md`. Schema uses a **synthetic `id` PK + a separate `@@unique(...)` on the dim tuple** — read the rationale below.

`SyncCursor` — single-row-per-job watermark store. `key` is the job name (`ibc-transfers`). All last_* columns are nullable to allow first-run absence.

## Non-obvious schema decisions

### Synthetic `id` + `UNIQUE NULLS NOT DISTINCT` on `IbcDailyStats`

The natural key is `(date, channel_id_src, direction, denom)`. Both `channel_id_src` and `denom` are nullable to encode the 4 rollup levels (full / channel-rollup / denom-rollup / global). Prisma does **not** allow nullable columns in `@@id`, so:

1. We add `id Int @id @default(autoincrement())` as a synthetic PK.
2. We add `@@unique([date, channelIdSrc, direction, denom], map: "ibc_daily_stats_dim_uniq")` to enforce dim uniqueness.
3. The migration is **hand-patched** to add `NULLS NOT DISTINCT` to that unique index (Postgres 15+ feature). Without it, two rollup rows with `denom = NULL` would not collide and `ON CONFLICT` in `recompute-daily-stats` would insert duplicates instead of updating.

Look at line 110 of `migration.sql`:

```sql
CREATE UNIQUE INDEX "ibc_daily_stats_dim_uniq" ON "ibc_daily_stats"
  ("date", "channel_id_src", "direction", "denom") NULLS NOT DISTINCT;
```

If you regenerate this migration via `prisma migrate dev`, the `NULLS NOT DISTINCT` clause **will be stripped** — Prisma does not yet emit it. Re-apply by hand or the recompute job will start producing duplicate rollup rows.

### Driver adapter pattern (Prisma 7)

Prisma 7 requires a driver adapter for new code paths. We use `PrismaPg` from `@prisma/adapter-pg` instead of the legacy native engine:

```ts
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const db = new PrismaClient({ adapter });
```

Implications:
- `datasource.url` is **not** in `schema.prisma` (Prisma 7 P1012 forbids it). It is in `prisma.config.ts`.
- The legacy `previewFeatures = ["driverAdapters"]` flag is **not** in the generator block — that flag is deprecated in Prisma 7; driver adapters are stable.
- `new PrismaClient({ datasourceUrl: ... })` is **invalid** in Prisma 7. Use the adapter.

Singleton wiring lives in `src/db.ts`. Do not instantiate `PrismaClient` anywhere else.

## Migration policy

- Migrations are append-only. Never edit a committed migration's SQL — add a new migration instead.
- The hand-patched `NULLS NOT DISTINCT` line in `20260515075735_init` is a **one-time** deviation from Prisma's emitted output. Document it here every time the migration is regenerated.
- Local dev path for a clean reset: `docker compose down && docker volume rm chain-data-indexer_pgdata && docker compose up -d postgres && yarn db:deploy && yarn db:seed`. Avoid `prisma migrate reset` — it is blocked by an AI-safety check that requires `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION`.

## Seed

`yarn db:seed` runs `tsx prisma/seed.ts` and idempotently upserts the full asset list defined inline in that file. Add new assets to the `ASSETS` array, not via raw SQL — keeping them in one place makes the `getAllAssets()` driven cron jobs (`get-prices`, `get-price-history`) pick them up automatically on the next tick. Production deploys run seed automatically as part of the `migrations` compose service (`yarn db:deploy && yarn db:seed`).
