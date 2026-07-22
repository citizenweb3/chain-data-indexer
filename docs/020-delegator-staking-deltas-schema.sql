\set ON_ERROR_STOP on
-- Schema for the precomputed staking-deltas feed.
--
-- staking/deltas used to resolve authz-wrapped MsgExec batches on every request (join
-- core.messages -> core.transactions + jsonb_array_elements). That is unbounded per delegator
-- and hits statement_timeout for heavy accounts. Instead we precompute the resolved deltas into
-- request-shaped tables that the API reads with a single indexed point lookup.
--
-- These are DERIVED tables (not raw event logs): flat / non-partitioned on purpose, because the
-- access pattern is per-delegator and partitioning by height would fight it. Rebuilt any time by
-- truncating and re-running the backfill; refreshed incrementally by docs/021 via cron.

CREATE TABLE IF NOT EXISTS stake.delegator_staking_deltas (
  delegator_address text          NOT NULL,
  height            bigint        NOT NULL,
  tx_index          integer       NOT NULL,
  msg_index         integer       NOT NULL,
  tx_hash           text          NOT NULL,
  time              timestamptz   NOT NULL,
  event_type        text          NOT NULL,
  validator_src     text,
  validator_dst     text,
  denom             text          NOT NULL,
  -- amount is stored as text: docs/021 produces it from jsonb ->> and ::text, and the API
  -- returns it verbatim as a string. This feed never sorts/compares on amount numerically
  -- (ORDER BY is height/tx_index/msg_index), so text is exact and cast-free.
  amount            text          NOT NULL,
  sign              smallint      NOT NULL,
  source            text          NOT NULL,
  PRIMARY KEY (delegator_address, height, tx_index, msg_index)
);

-- Covering index for the feed's exact ORDER BY (height DESC, tx_index DESC, msg_index DESC)
-- scoped to one delegator. Makes the API query a pure Index Scan, no sort.
CREATE INDEX IF NOT EXISTS idx_delegator_staking_deltas_feed
  ON stake.delegator_staking_deltas (delegator_address, height DESC, tx_index DESC, msg_index DESC);

-- Per-delegator totals so the stats call is an indexed point lookup instead of a recompute.
CREATE TABLE IF NOT EXISTS stake.delegator_staking_delta_stats (
  delegator_address         text   PRIMARY KEY,
  total                     bigint NOT NULL DEFAULT 0,
  skipped_ambiguous_msgexec bigint NOT NULL DEFAULT 0
);

-- Single-row watermark for incremental refresh. id is fixed true so there is at most one row.
CREATE TABLE IF NOT EXISTS stake.staking_deltas_refresh_state (
  id                  boolean PRIMARY KEY DEFAULT true,
  last_indexed_height bigint  NOT NULL DEFAULT 0,
  CONSTRAINT staking_deltas_refresh_state_single_row CHECK (id)
);

INSERT INTO stake.staking_deltas_refresh_state (id, last_indexed_height)
  VALUES (true, 0)
  ON CONFLICT (id) DO NOTHING;
