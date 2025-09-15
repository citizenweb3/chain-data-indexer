-- ============================================================================
-- 020-patches.sql — additional idempotent indexes/fixes for the schema
-- Purpose: keep this file safe to run multiple times on any environment.
-- Notes:
--   * Uses conditional DO blocks and IF EXISTS guards.
--   * Targets only auxiliary indexes/partitions that may be missing.
-- ============================================================================

-- TRANSACTIONS: helper indexes (success-path and time ordering)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'core' AND table_name = 'transactions'
  ) THEN
    -- Fast access to successful tx within a block
    CREATE INDEX IF NOT EXISTS idx_txs_success
      ON core.transactions (height DESC, tx_index)
      WHERE code = 0;

    -- Sorting/filtering by time
    CREATE INDEX IF NOT EXISTS idx_txs_time
      ON core.transactions (time DESC);
  END IF;
END $$;

-- MESSAGES: ensure initial partition exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'core' AND table_name = 'messages'
  ) THEN
    CREATE TABLE IF NOT EXISTS core.messages_p0
      PARTITION OF core.messages
      FOR VALUES FROM (0) TO (1000000);
  END IF;
END $$;

-- EVENTS: index by (event_type, msg_index)
-- (Table core.events has no height column — only use existing fields)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'core' AND table_name = 'events'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_events_type_msg
      ON core.events (event_type, msg_index);
  END IF;
END $$;

-- EVENT_ATTRS: baseline index on key (safety if 010 was modified)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'core' AND table_name = 'event_attrs'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_event_attrs_key
      ON core.event_attrs (key);
  END IF;
END $$;