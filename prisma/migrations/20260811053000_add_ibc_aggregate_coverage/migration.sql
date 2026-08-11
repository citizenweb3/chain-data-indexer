-- Preserve legacy rollups with NULL coverage. Corrected rows are populated by
-- recompute-daily-stats after this migration; the empty denom array is only an
-- internal storage default and is never exposed while counts remain NULL.
ALTER TABLE "ibc_daily_stats"
    ADD COLUMN "eligible_packets" BIGINT,
    ADD COLUMN "priced_packets" BIGINT,
    ADD COLUMN "unpriced_packets" BIGINT,
    ADD COLUMN "unpriced_denoms" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- One durable row per chain makes the retained-range correction triggerable
-- and lets readers distinguish corrected history from irrecoverable legacy
-- rollups without overloading packet sync cursor fields.
CREATE TABLE "ibc_aggregate_states" (
    "chain" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "corrected_from" DATE,
    "last_recomputed_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ibc_aggregate_states_pkey" PRIMARY KEY ("chain"),
    CONSTRAINT "ibc_aggregate_states_chain_fkey"
        FOREIGN KEY ("chain") REFERENCES "chains"("name")
        ON DELETE RESTRICT ON UPDATE CASCADE
);
