-- Add raw Logos transactions for already-initialized databases.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS logos_transactions (
    id              TEXT        PRIMARY KEY,
    tx_hash         TEXT,
    block_id        TEXT        NOT NULL REFERENCES logos_blocks(id) ON DELETE CASCADE,
    position        INTEGER     NOT NULL,
    raw             JSONB       NOT NULL,
    indexed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (block_id, position)
);

CREATE INDEX IF NOT EXISTS logos_transactions_block ON logos_transactions (block_id, position);
CREATE INDEX IF NOT EXISTS logos_transactions_hash  ON logos_transactions (tx_hash) WHERE tx_hash IS NOT NULL;

INSERT INTO logos_transactions (id, tx_hash, block_id, position, raw)
SELECT
    COALESCE(tx_elem.value->'mantle_tx'->>'hash', logos_blocks.id || ':' || (tx_elem.ordinality - 1)::text) AS id,
    tx_elem.value->'mantle_tx'->>'hash' AS tx_hash,
    logos_blocks.id AS block_id,
    (tx_elem.ordinality - 1)::integer AS position,
    tx_elem.value AS raw
FROM logos_blocks
CROSS JOIN LATERAL jsonb_array_elements(logos_blocks.raw->'transactions') WITH ORDINALITY AS tx_elem(value, ordinality)
WHERE jsonb_typeof(logos_blocks.raw->'transactions') = 'array'
ON CONFLICT DO NOTHING;
