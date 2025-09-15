CREATE SCHEMA IF NOT EXISTS core;

CREATE TABLE IF NOT EXISTS core.indexer_progress (
                                                     id          text PRIMARY KEY,
                                                     last_height bigint NOT NULL,
                                                     updated_at  timestamptz NOT NULL DEFAULT now()
);