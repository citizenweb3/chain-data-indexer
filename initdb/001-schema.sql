-- Logos Indexer — PostgreSQL schema
-- Version: 0.1.0 — compatible with Logos Blockchain v0.1.2 (testnet)
--
-- Run with:  psql $DATABASE_URL -f initdb/001-schema.sql
-- Or via:    npm run db:init

-- ─── Active tables (v0.1.2) ──────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS logos_blocks (
    id              TEXT        PRIMARY KEY,    -- header.id from /cryptarchia/blocks
    parent_block    TEXT        NOT NULL,
    slot            BIGINT      NOT NULL,
    height          BIGINT,
    block_root      TEXT        NOT NULL,
    leader_key      TEXT        NOT NULL,       -- proof_of_leadership.leader_key
    voucher_cm      TEXT        NOT NULL,       -- proof_of_leadership.voucher_cm
    entropy         TEXT        NOT NULL,       -- proof_of_leadership.entropy_contribution
    tx_count        INTEGER     NOT NULL DEFAULT 0,
    raw             JSONB       NOT NULL,       -- full block JSON for forward compatibility
    finalized       BOOLEAN     NOT NULL DEFAULT false, -- true once block height ≤ LIB height
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS logos_blocks_slot       ON logos_blocks (slot);
CREATE INDEX IF NOT EXISTS logos_blocks_leader     ON logos_blocks (leader_key);
CREATE INDEX IF NOT EXISTS logos_blocks_height     ON logos_blocks (height) WHERE height IS NOT NULL;
CREATE INDEX IF NOT EXISTS logos_blocks_unfinalized ON logos_blocks (height) WHERE NOT finalized;

-- Proof leader-key diagnostics — updated on every block insert.
--
-- Logos v0.1.2 exposes proof_of_leadership.leader_key in block headers but does
-- not expose a stable validator identity. Keep the legacy table/column names
-- for upgrade compatibility; public APIs expose this as /leader-keys, not
-- /validators.
CREATE TABLE IF NOT EXISTS logos_leaders (
    leader_key          TEXT        PRIMARY KEY,
    blocks_produced     BIGINT      NOT NULL DEFAULT 0,
    first_block_slot    BIGINT,
    last_block_slot     BIGINT,
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Raw block transactions. Current Logos runtime emits `mantle_tx` objects in
-- block.transactions[]; keep them as raw JSON plus stable identifiers so the
-- explorer can list and inspect them without inventing protocol-specific
-- decoded tables.
CREATE TABLE IF NOT EXISTS logos_transactions (
    id              TEXT        PRIMARY KEY,     -- mantle_tx.hash when present, else block_id:position
    tx_hash         TEXT,                        -- mantle_tx.hash when present
    block_id        TEXT        NOT NULL REFERENCES logos_blocks(id) ON DELETE CASCADE,
    position        INTEGER     NOT NULL,        -- index within block.transactions[]
    raw             JSONB       NOT NULL,
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (block_id, position)
);

CREATE INDEX IF NOT EXISTS logos_transactions_block     ON logos_transactions (block_id, position);
CREATE INDEX IF NOT EXISTS logos_transactions_hash      ON logos_transactions (tx_hash) WHERE tx_hash IS NOT NULL;

-- Resume support — stores last indexed slot so the indexer can restart from
-- where it left off instead of re-scanning from slot 0.
CREATE TABLE IF NOT EXISTS logos_indexer_progress (
    id              TEXT        PRIMARY KEY DEFAULT 'default',
    last_slot       BIGINT      NOT NULL DEFAULT 0,
    last_height     BIGINT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO logos_indexer_progress (id, last_slot) VALUES ('default', 0)
ON CONFLICT (id) DO NOTHING;

-- ─── Reserved for v0.2+ (not yet active) ─────────────────────────────────────
-- Uncomment and migrate when Logos v0.2 enables transactions and UTXO tracking.
--
-- UTXO note lifecycle: track individual note creation and spending.
-- CREATE TABLE IF NOT EXISTS logos_notes (
--     note_id         TEXT        PRIMARY KEY,  -- note commitment hash
--     address         TEXT        NOT NULL,     -- owner public key
--     value           BIGINT      NOT NULL,
--     created_in_tx   TEXT,                     -- NULL = genesis / faucet
--     spent_in_tx     TEXT,                     -- NULL = unspent
--     indexed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
-- );
--
-- Balance snapshots: periodic polls of /wallet/:key/balance for watched addresses.
-- Only possible for keys the local node has in its wallet (ZK privacy limitation).
-- May become more broadly useful if a future API version exposes aggregate balances.
-- CREATE TABLE IF NOT EXISTS logos_watched_addresses (
--     address         TEXT        PRIMARY KEY,
--     label           TEXT,
--     added_at        TIMESTAMPTZ NOT NULL DEFAULT now()
-- );
-- CREATE TABLE IF NOT EXISTS logos_balance_snapshots (
--     address         TEXT        NOT NULL,
--     slot            BIGINT      NOT NULL,
--     tip             TEXT,
--     balance         BIGINT      NOT NULL,
--     raw_notes       JSONB,
--     indexed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
--     PRIMARY KEY (address, slot)
-- );
