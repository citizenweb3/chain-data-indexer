CREATE TABLE IF NOT EXISTS monero_transactions (
    hash            TEXT        PRIMARY KEY,
    block_hash      TEXT        NOT NULL REFERENCES monero_blocks(hash) ON DELETE CASCADE,
    block_height    BIGINT      NOT NULL,
    position        INTEGER     NOT NULL,
    version         INTEGER     NOT NULL,
    unlock_time     BIGINT      NOT NULL,
    inputs_count    INTEGER     NOT NULL DEFAULT 0,
    outputs_count   INTEGER     NOT NULL DEFAULT 0,
    fee_atomic      TEXT,
    in_pool         BOOLEAN     NOT NULL DEFAULT false,
    confirmations   BIGINT,
    raw             JSONB       NOT NULL,
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (block_hash, position)
);

CREATE INDEX IF NOT EXISTS monero_transactions_block_idx
    ON monero_transactions (block_hash, position);

CREATE INDEX IF NOT EXISTS monero_transactions_height_idx
    ON monero_transactions (block_height DESC, position ASC);

CREATE INDEX IF NOT EXISTS monero_transactions_fee_idx
    ON monero_transactions (fee_atomic)
    WHERE fee_atomic IS NOT NULL;

CREATE TABLE IF NOT EXISTS monero_supply_checkpoints (
    height                      BIGINT      PRIMARY KEY,
    block_hash                  TEXT        NOT NULL,
    block_timestamp             BIGINT      NOT NULL,
    cumulative_emission_atomic  TEXT        NOT NULL,
    cumulative_fee_atomic       TEXT        NOT NULL DEFAULT '0',
    source_method               TEXT        NOT NULL,
    computed_at                 TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS monero_supply_checkpoints_hash_idx
    ON monero_supply_checkpoints (block_hash);

CREATE INDEX IF NOT EXISTS monero_supply_checkpoints_computed_idx
    ON monero_supply_checkpoints (computed_at DESC);
