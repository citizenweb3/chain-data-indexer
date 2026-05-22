-- Phase 1: chains registry + chain dimension on storage tables.
-- The chains rows are INSERTed before any FK ALTER so the backfill DEFAULT
-- ('cosmoshub') can satisfy the foreign-key constraint as the column is added.

-- 1. chains registry + seed (must precede FK ALTERs)
CREATE TABLE "chains" (
    "name" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "chain_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "chains_pkey" PRIMARY KEY ("name")
);

CREATE UNIQUE INDEX "chains_chain_id_key" ON "chains"("chain_id");

INSERT INTO "chains" ("name", "display_name", "chain_id") VALUES
    ('cosmoshub', 'Cosmos Hub', 'cosmoshub-4'),
    ('atomone',   'AtomOne',    'atomone-1');

-- 2. ibc_packets — add column with default for backfill + FK, then drop default
ALTER TABLE "ibc_packets"
    ADD COLUMN "chain" TEXT NOT NULL DEFAULT 'cosmoshub'
        REFERENCES "chains"("name") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ibc_packets" ALTER COLUMN "chain" DROP DEFAULT;

ALTER TABLE "ibc_packets" DROP CONSTRAINT "ibc_packets_pkey";
ALTER TABLE "ibc_packets" ADD CONSTRAINT "ibc_packets_pkey"
    PRIMARY KEY ("chain", "channel_id_src", "port_id_src", "sequence");

DROP INDEX IF EXISTS "ibc_packets_event_time_idx";
CREATE INDEX "ibc_packets_chain_event_time_idx"
    ON "ibc_packets" ("chain", "event_time" DESC);

DROP INDEX IF EXISTS "ibc_packets_channel_id_src_direction_event_time_idx";
CREATE INDEX "ibc_packets_chain_channel_id_src_direction_event_time_idx"
    ON "ibc_packets" ("chain", "channel_id_src", "direction", "event_time" DESC);

DROP INDEX IF EXISTS "ibc_packets_denom_event_time_idx";
CREATE INDEX "ibc_packets_chain_denom_event_time_idx"
    ON "ibc_packets" ("chain", "denom", "event_time" DESC);

-- 3. ibc_daily_stats
ALTER TABLE "ibc_daily_stats"
    ADD COLUMN "chain" TEXT NOT NULL DEFAULT 'cosmoshub'
        REFERENCES "chains"("name") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ibc_daily_stats" ALTER COLUMN "chain" DROP DEFAULT;

-- Rebuild the dim-uniq index with `chain` prefix and preserve NULLS NOT DISTINCT
-- so that rollup rows with NULL channel_id_src/denom still collide on conflict
-- (required by recompute-daily-stats; Postgres 15+ feature).
DROP INDEX IF EXISTS "ibc_daily_stats_dim_uniq";
CREATE UNIQUE INDEX "ibc_daily_stats_dim_uniq"
    ON "ibc_daily_stats" ("chain", "date", "channel_id_src", "direction", "denom") NULLS NOT DISTINCT;

DROP INDEX IF EXISTS "ibc_daily_stats_date_idx";
CREATE INDEX "ibc_daily_stats_chain_date_idx"
    ON "ibc_daily_stats" ("chain", "date");

-- 4. ibc_channels
ALTER TABLE "ibc_channels"
    ADD COLUMN "chain" TEXT NOT NULL DEFAULT 'cosmoshub'
        REFERENCES "chains"("name") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ibc_channels" ALTER COLUMN "chain" DROP DEFAULT;

ALTER TABLE "ibc_channels" DROP CONSTRAINT "ibc_channels_pkey";
ALTER TABLE "ibc_channels" ADD CONSTRAINT "ibc_channels_pkey"
    PRIMARY KEY ("chain", "channel_id_src", "port_id_src");

-- 5. sync_cursors
ALTER TABLE "sync_cursors"
    ADD COLUMN "chain" TEXT NOT NULL DEFAULT 'cosmoshub'
        REFERENCES "chains"("name") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sync_cursors" ALTER COLUMN "chain" DROP DEFAULT;

ALTER TABLE "sync_cursors" DROP CONSTRAINT "sync_cursors_pkey";
ALTER TABLE "sync_cursors" ADD CONSTRAINT "sync_cursors_pkey"
    PRIMARY KEY ("chain", "key");
