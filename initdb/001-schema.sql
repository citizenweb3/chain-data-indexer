-- Monero Indexer — PostgreSQL schema
-- Compatible with monerod v0.18.x

CREATE TABLE IF NOT EXISTS monero_blocks (
    hash                        TEXT        PRIMARY KEY,
    prev_hash                   TEXT        NOT NULL,
    height                      BIGINT      NOT NULL,
    timestamp                   BIGINT      NOT NULL,
    major_version               INTEGER     NOT NULL,
    minor_version               INTEGER     NOT NULL,
    nonce                       BIGINT      NOT NULL,
    block_size                  BIGINT      NOT NULL,
    block_weight                BIGINT      NOT NULL,
    long_term_weight            BIGINT      NOT NULL,
    num_txes                    INTEGER     NOT NULL DEFAULT 0,
    miner_tx_hash               TEXT        NOT NULL,
    reward_atomic               TEXT        NOT NULL,
    difficulty_hex              TEXT        NOT NULL,
    cumulative_difficulty_hex   TEXT        NOT NULL,
    orphan_status               BOOLEAN     NOT NULL DEFAULT false,
    is_canonical                BOOLEAN     NOT NULL DEFAULT false,
    is_settled                  BOOLEAN     NOT NULL DEFAULT false,
    raw                         JSONB       NOT NULL,
    indexed_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS monero_blocks_height_idx
    ON monero_blocks (height DESC);

CREATE INDEX IF NOT EXISTS monero_blocks_prev_hash_idx
    ON monero_blocks (prev_hash);

CREATE INDEX IF NOT EXISTS monero_blocks_height_hash_idx
    ON monero_blocks (height DESC, hash);

CREATE INDEX IF NOT EXISTS monero_blocks_canonical_height_idx
    ON monero_blocks (height DESC)
    WHERE is_canonical;

CREATE INDEX IF NOT EXISTS monero_blocks_settled_height_idx
    ON monero_blocks (height DESC)
    WHERE is_settled;

CREATE TABLE IF NOT EXISTS monero_indexer_progress (
    id              TEXT        PRIMARY KEY DEFAULT 'default',
    last_height     BIGINT      NOT NULL DEFAULT -1,
    last_hash       TEXT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO monero_indexer_progress (id, last_height, last_hash)
VALUES ('default', -1, NULL)
ON CONFLICT (id) DO NOTHING;
