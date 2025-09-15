-- 035-events-hash-partitions.sql
-- Purpose: Create missing hash partitions for core.events and attach child indexes to partitioned parents.
-- Safety: Idempotent. Safe to run multiple times.
-- Notes:
--   • Assumes table core.events exists and is HASH-partitioned by (tx_hash).
--   • Assumes parent partitioned indexes core.idx_events_type and core.idx_events_type_msg already exist
--     (created on core.events as partitioned indexes). If they don't, the ATTACH operations will be skipped.
--   • Number of partitions can be adjusted via the constant `n` below.

DO $$
DECLARE
    n           int := 16;  -- number of hash partitions (modulus)
    i           int;
    part_name   text;
    idx1_name   text;       -- child index name for (event_type)
    idx2_name   text;       -- child index name for (event_type, msg_index)
    has_events  boolean;
    has_parent1 boolean;    -- parent partitioned index: core.idx_events_type
    has_parent2 boolean;    -- parent partitioned index: core.idx_events_type_msg
BEGIN
    -- Guard: ensure the parent table exists; if not, do nothing but inform the operator.
    SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'core' AND table_name = 'events'
    ) INTO has_events;

    IF NOT has_events THEN
        RAISE NOTICE 'core.events does not exist; skipping partition creation.';
        RETURN;
    END IF;

    -- Cache whether parent partitioned indexes exist (so ATTACH can be attempted conditionally)
    SELECT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'core' AND c.relname = 'idx_events_type'
    ) INTO has_parent1;

    SELECT EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace ns ON ns.oid = c.relnamespace
        WHERE ns.nspname = 'core' AND c.relname = 'idx_events_type_msg'
    ) INTO has_parent2;

    -- 1) Create missing partitions: core.events_h00 .. core.events_h{n-1}
    FOR i IN 0..n-1 LOOP
        part_name := 'events_h' || to_char(i, 'FM00');

        IF NOT EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_namespace ns ON ns.oid = c.relnamespace
            WHERE ns.nspname = 'core' AND c.relname = part_name
        ) THEN
            EXECUTE format(
                'CREATE TABLE core.%I PARTITION OF core.events FOR VALUES WITH (MODULUS %s, REMAINDER %s);',
                part_name, n, i
            );
        END IF;
    END LOOP;

    -- 2) For each partition, create child indexes and attach them to the partitioned parents
    FOR i IN 0..n-1 LOOP
        part_name := 'events_h' || to_char(i, 'FM00');

        idx1_name := part_name || '_event_type_idx';
        idx2_name := part_name || '_event_type_msg_index_idx';

        -- Create child index (event_type) on partition if missing
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON core.%I (event_type);', idx1_name, part_name);

        -- Attach to parent partitioned index core.idx_events_type if present and not yet attached
        IF has_parent1 AND NOT EXISTS (
            SELECT 1
            FROM pg_inherits inh
            JOIN pg_class c  ON c.oid  = inh.inhrelid
            JOIN pg_class p  ON p.oid  = inh.inhparent
            JOIN pg_namespace nc ON nc.oid = c.relnamespace
            JOIN pg_namespace np ON np.oid = p.relnamespace
            WHERE np.nspname = 'core' AND p.relname = 'idx_events_type'
              AND nc.nspname = 'core' AND c.relname = idx1_name
        ) THEN
            BEGIN
                EXECUTE format('ALTER INDEX core.idx_events_type ATTACH PARTITION core.%I;', idx1_name);
            EXCEPTION WHEN others THEN
                -- e.g. "Another index is already attached for partition …" — ignore
                NULL;
            END;
        END IF;

        -- Create child index (event_type, msg_index) on partition if missing
        EXECUTE format('CREATE INDEX IF NOT EXISTS %I ON core.%I (event_type, msg_index);', idx2_name, part_name);

        -- Attach to parent partitioned index core.idx_events_type_msg if present and not yet attached
        IF has_parent2 AND NOT EXISTS (
            SELECT 1
            FROM pg_inherits inh
            JOIN pg_class c  ON c.oid  = inh.inhrelid
            JOIN pg_class p  ON p.oid  = inh.inhparent
            JOIN pg_namespace nc ON nc.oid = c.relnamespace
            JOIN pg_namespace np ON np.oid = p.relnamespace
            WHERE np.nspname = 'core' AND p.relname = 'idx_events_type_msg'
              AND nc.nspname = 'core' AND c.relname = idx2_name
        ) THEN
            BEGIN
                EXECUTE format('ALTER INDEX core.idx_events_type_msg ATTACH PARTITION core.%I;', idx2_name);
            EXCEPTION WHEN others THEN
                NULL;
            END;
        END IF;
    END LOOP;
END$$;