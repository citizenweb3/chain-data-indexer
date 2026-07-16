-- v5 migration (S4 part 3, AZTEC_V5_MIGRATION.md §3.1/§4): partition the
-- listener's height cursor by rollup version so a NEW rollup version
-- starts its own cursor at 0 instead of silently inheriting the old
-- version's processed heights (e.g. processedProposed=117975).
--
-- Hand-edited from the raw `drizzle-kit generate` output: drizzle-kit
-- cannot introspect the existing single-column primary key's constraint
-- name (see its own comment, removed here) and emitted `ADD COLUMN
-- "rollupVersion" bigint NOT NULL` with no default, which would fail on
-- any pre-existing row (prod currently has exactly one: the MAINNET row
-- with processedProposed=117975 / processedProven=84261, tracking the old
-- v4.1.1 rollup). Reordered into: add nullable -> backfill -> enforce
-- NOT NULL -> swap the primary key.
--
-- The backfill stamps every pre-existing row with 2934756905 (v4_1_1,
-- see services/explorer-api/src/constants/versions.ts) because that is
-- the only rollup version this table has ever tracked prior to this
-- migration - this preserves the old cursor's association with the OLD
-- chain (do NOT wipe it, see §3.1b) rather than losing it or leaving it
-- ambiguous. Once this lands, ensureInitializedBlockHeights() will create
-- a brand-new (networkId, rollupVersion=4248422647) row on first startup
-- against a v5 node, independent of this one, starting at height 0.
ALTER TABLE "heights" ADD COLUMN "rollupVersion" bigint;--> statement-breakpoint
UPDATE "heights" SET "rollupVersion" = 2934756905 WHERE "rollupVersion" IS NULL;--> statement-breakpoint
ALTER TABLE "heights" ALTER COLUMN "rollupVersion" SET NOT NULL;--> statement-breakpoint
-- NOTE: "heights_pkey" is Postgres's default auto-generated name for a
-- single-column inline `PRIMARY KEY` constraint (as used in migration
-- 0000_numerous_skin.sql: `"networkId" varchar PRIMARY KEY NOT NULL`).
-- VERIFY against prod before applying, e.g.:
--   SELECT constraint_name FROM information_schema.table_constraints
--   WHERE table_schema = 'public' AND table_name = 'heights'
--     AND constraint_type = 'PRIMARY KEY';
ALTER TABLE "heights" DROP CONSTRAINT "heights_pkey";--> statement-breakpoint
ALTER TABLE "heights" ADD CONSTRAINT "heights_networkId_rollupVersion_pk" PRIMARY KEY("networkId","rollupVersion");
