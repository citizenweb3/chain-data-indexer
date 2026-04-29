-- Miden Indexer — placeholder PostgreSQL schema
-- Full schema TBD by the schema agent.

CREATE TABLE IF NOT EXISTS miden_indexer_progress (
    id              TEXT        PRIMARY KEY DEFAULT 'default',
    last_block_num  BIGINT      NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO miden_indexer_progress (id, last_block_num) VALUES ('default', 0)
ON CONFLICT (id) DO NOTHING;
