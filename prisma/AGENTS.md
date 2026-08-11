# prisma/

Prisma schema, migrations, and seed for the meta-indexer Postgres.

## Files

| File | Purpose |
|------|---------|
| `schema.prisma` | 9 models — `Chain`, `IbcPacket`, `Asset`, `Price`, `PriceHistory`, `IbcDailyStats`, `IbcAggregateState`, `IbcChannel`, `SyncCursor` |
| `migrations/20260515075735_init/migration.sql` | Initial DDL — includes hand-patched `NULLS NOT DISTINCT` index |
| `migrations/20260517120000_add_ibc_channels/migration.sql` | `ibc_channels` lookup table for counterparty chain metadata |
| `migrations/20260521073429_add_chain_multitenancy/migration.sql` | `chains` registry + `chain` dimension on `ibc_packets`, `ibc_daily_stats`, `ibc_channels`, `sync_cursors` |
| `migrations/20260811053000_add_ibc_aggregate_coverage/migration.sql` | Nullable daily coverage counters + per-chain aggregate correction state |
| `seed.ts` | Idempotent upsert of 2 chains, ~57 assets, and 80 IBC channels (see `CHAINS_SEED` + `ASSETS` + `IBC_CHANNELS` arrays) |

`prisma.config.ts` lives in the repo root, **not here**. Prisma 7 mandates it (replaces `datasource.url` in the schema). It loads `DATABASE_URL` via `dotenv/config` and wires the `prisma/seed.ts` runner. Touch it if migration paths or seed command change.

## Models

`Chain` — registry of supported networks. Text PK on `name` (the URL slug, e.g. `cosmoshub`, `atomone`). `displayName` and `chainId` are the UI label and the on-chain network id. Every other storage table FKs to `chains.name`; the slug **is** the join key — no JOIN needed for filtering. Seeded by `seed.ts` (`CHAINS_SEED`). Adding a chain in production requires (a) appending a row to `CHAINS_SEED`, (b) adding a config entry in `server/tools/chains/params.ts`, and (c) supplying the `<CHAIN>_INDEXER_API_KEY` env var (upstream URL lives in `server/tools/chains/params.ts`).

`IbcPacket` — local mirror of upstream `/api/v1/ibc/transfers`. PK `(chain, channelIdSrc, portIdSrc, sequence)`. Nullable `event_height` / `event_time` for transient `sent` packets that have no block yet. `amount: Decimal(80, 0)` matches upstream `NUMERIC(80,0)` — never coerce to JS `number`.

`Asset` — coingecko-priced asset registry. `nativeDenom` is unique (used by `getAssetByDenom`). Seeded with ~56 assets — see `seed.ts` `ASSETS` constant. The seed is idempotent (upsert by `nativeDenom`), so re-running it after adding a row only inserts the new one.

`Price` — point-in-time spot prices written by the `prices` cron (every 5 min). Append-only; no upsert.

`PriceHistory` — daily closing prices from CoinGecko `market_chart`. PK `(assetId, date)`. Upsert by compound PK.

`IbcDailyStats` — pre-aggregated rollup for the API stats/channels/timeseries services. Pre-cube of 4 `GROUPING SETS` levels; see `server/jobs/AGENTS.md`. Coverage counters are nullable because rows older than packet retention cannot be recomputed and remain explicitly legacy. Schema uses a **synthetic `id` PK + a separate `@@unique(...)` on the dim tuple** — read the rationale below.

`IbcAggregateState` — one row per chain recording the aggregate contract version, earliest corrected daily date, and last successful recompute heartbeat. It is updated atomically with daily slice replacement; do not encode this state into packet sync cursor fields.

`IbcChannel` — per-chain lookup of IBC channels to their counterparty chain (chain-registry mainnet). PK `(chain, channelIdSrc, portIdSrc)`. Seeded from `prisma/seed.ts` `IBC_CHANNELS` array, which is generated from `github.com/cosmos/chain-registry` `_IBC/*.json` for every supported chain — do **not** hand-edit individual rows. To regenerate the array, sparse-clone the registry, run the jq pipeline in the working notes, and replace the array verbatim. `counterpartyChainName` is the registry slug (lowercase, no separators); UI is responsible for display casing.

`SyncCursor` — per-chain, per-job watermark store. PK `(chain, key)`. `key` is the job name (`sync-ibc-transfers`, `recompute-daily-stats`). All last_* columns are nullable to allow first-run absence.

## Multi-chain: `(chain, ...)` PK convention

All four storage tables include `chain TEXT NOT NULL REFERENCES chains(name)` as the first column of their PK / unique index:

| Table | PK / UNIQUE |
|---|---|
| `ibc_packets` | PK `(chain, channel_id_src, port_id_src, sequence)` |
| `ibc_daily_stats` | UNIQ `(chain, date, channel_id_src, direction, denom)` (NULLS NOT DISTINCT) |
| `ibc_channels` | PK `(chain, channel_id_src, port_id_src)` |
| `sync_cursors` | PK `(chain, key)` |

Secondary indexes are likewise chain-prefixed (`ibc_packets_chain_event_time_idx`, etc.) so per-chain reads stay on a single B-tree subtree. The two `IbcChannel` counterparty indexes (`counterparty_chain_id`, `counterparty_channel_id+counterparty_port_id`) are deliberately **not** chain-prefixed — reverse lookups across chains for the combined view are a valid use case.

When upserting from application code, the compound-key fields are nested under `chain_<...>` (e.g. `db.ibcPacket.upsert({ where: { chain_channelIdSrc_portIdSrc_sequence: { chain, channelIdSrc, portIdSrc, sequence } } })`). Forgetting the leading `chain_` is the most common Prisma-7 error after this refactor.

### Migration ordering rule for new chain-aware tables

The Phase 1 migration (`20260521073429_add_chain_multitenancy`) creates the `chains` table and **INSERTs the two seed rows in the same SQL file** before any `ALTER TABLE ... ADD COLUMN chain ... REFERENCES chains(name)` runs. The column is added with `DEFAULT 'cosmoshub'` to backfill existing rows, then the default is dropped immediately afterwards. Any future migration that introduces a new chain-aware storage table must follow the same order: chains-row INSERTs **before** FK column ALTERs.

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

`yarn db:seed` runs `tsx prisma/seed.ts` and idempotently upserts three lists, in order:

1. `CHAINS_SEED` — every supported chain (`name`, `displayName`, `chainId`). Upsert by `name`. Must run **before** any chain-referencing rows so the FK target exists.
2. `ASSETS` — coingecko-priced asset registry. Add new assets here, not via raw SQL — keeping them in one place makes the `getAllAssets()` driven cron jobs (`get-prices`, `get-price-history`) pick them up automatically on the next tick.
3. `IBC_CHANNELS` — chain-registry-derived channels, tagged with their owning `chain`. Upsert by compound key `(chain, channelIdSrc, portIdSrc)`.

Re-running the seed is safe — upserts converge. Production deploys run seed automatically as part of the `migrations` compose service (`yarn db:deploy && yarn db:seed`).
