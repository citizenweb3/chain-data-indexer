-- =====================================================================
-- 040-bootstrap-partitions.sql  (idempotent)
-- Optional parameters before execution:
--   SET app.part.steps = 'N';             -- int >= 0, number of RANGE partitions to create per table
--   SET app.part.target_height = 'H';     -- bigint > 0, target upper height for RANGE partitions
--   SET app.events.hash_modulus = 'M';    -- int >= 1, number of HASH partitions for core.events (default 16)
--   SET app.events.hash_prefix = 'pref';  -- text, prefix for HASH partition names (default 'h')
-- =====================================================================

-- 0) Create utility schema and partition config table
CREATE SCHEMA IF NOT EXISTS util;

-- Table for tracking partition ranges and current upper bound for each partitioned table
CREATE TABLE IF NOT EXISTS util.height_part_ranges (
    schema_name   TEXT NOT NULL,     -- schema of partitioned table
    table_name    TEXT NOT NULL,     -- name of partitioned table
    part_prefix   TEXT NOT NULL,     -- prefix for partition names
    span          BIGINT NOT NULL DEFAULT 1000000,  -- range span per partition
    current_to    BIGINT NOT NULL DEFAULT 1000000,  -- upper bound of current partition range
    PRIMARY KEY (schema_name, table_name)
);

-- 1) Function to create the next partition for a given table if not exists
CREATE OR REPLACE FUNCTION util.ensure_next_height_partition(p_schema TEXT, p_table TEXT)
    RETURNS VOID LANGUAGE plpgsql AS $function$
DECLARE
    cfg util.height_part_ranges%ROWTYPE;
    from_h BIGINT;
    to_h   BIGINT;
    part_name TEXT;
    sql TEXT;
BEGIN
    SELECT * INTO cfg
    FROM util.height_part_ranges
    WHERE schema_name = p_schema AND table_name = p_table
        FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No range config for %.% in util.height_part_ranges', p_schema, p_table;
    END IF;

    from_h := cfg.current_to;
    to_h   := cfg.current_to + cfg.span;
    part_name := format('%I.%I_%s%s', p_schema, p_table, cfg.part_prefix, from_h::text);

    IF EXISTS (
        SELECT 1
        FROM pg_class c
                 JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = p_schema
          AND c.relname = p_table || '_' || cfg.part_prefix || from_h::text
    ) THEN
        UPDATE util.height_part_ranges
        SET current_to = to_h
        WHERE schema_name = p_schema AND table_name = p_table;
        RETURN;
    END IF;

    sql := format(
            'CREATE TABLE IF NOT EXISTS %s PARTITION OF %I.%I FOR VALUES FROM (%s) TO (%s);',
            part_name, p_schema, p_table, from_h, to_h
           );
    EXECUTE sql;

    UPDATE util.height_part_ranges
    SET current_to = to_h
    WHERE schema_name = p_schema AND table_name = p_table;
END
$function$;

-- 1b) Function to ensure hash partitions exist for a table (safe if already partitioned)
CREATE OR REPLACE FUNCTION util.ensure_hash_partitions(p_schema TEXT, p_table TEXT, p_prefix TEXT, p_modulus INT)
    RETURNS VOID LANGUAGE plpgsql AS $function$
DECLARE
    i INT;
    v_has_children BOOLEAN;
BEGIN
    IF p_modulus IS NULL OR p_modulus < 1 THEN
        RAISE EXCEPTION 'Hash modulus must be >= 1 (got %)', p_modulus;
    END IF;

    -- If the parent already has any child partitions, skip creating new ones to avoid overlap
    SELECT EXISTS (
        SELECT 1
          FROM pg_inherits inh
          JOIN pg_class     child ON child.oid = inh.inhrelid
          JOIN pg_class     parent ON parent.oid = inh.inhparent
          JOIN pg_namespace ns ON ns.oid = parent.relnamespace
         WHERE ns.nspname = p_schema
           AND parent.relname = p_table
         LIMIT 1
    ) INTO v_has_children;

    IF v_has_children THEN
        RETURN;
    END IF;

    FOR i IN 0..(p_modulus - 1) LOOP
        EXECUTE format(
            'CREATE TABLE IF NOT EXISTS %I.%I_%s%s PARTITION OF %I.%I FOR VALUES WITH (MODULUS %s, REMAINDER %s);',
            p_schema, p_table, p_prefix, lpad(i::text, 2, '0'),
            p_schema, p_table, p_modulus, i
        );
    END LOOP;
END
$function$;

-- 2) Seed partition range configuration for each partitioned table (if not already present)
INSERT INTO util.height_part_ranges (schema_name, table_name, part_prefix, span, current_to)
VALUES
    ('core','blocks','p',1000000,1000000),
    ('core','transactions','p',1000000,1000000),
    ('core','messages','p',1000000,1000000),
    ('core','validator_set','p',1000000,1000000),
    ('core','validator_missed_blocks','p',1000000,1000000),
    ('bank','transfers','p',1000000,1000000),
    ('bank','balance_deltas','p',1000000,1000000),
    ('stake','delegation_events','p',1000000,1000000),
    ('stake','distribution_events','p',1000000,1000000),
    ('gov','deposits','p',1000000,1000000),
    ('gov','votes','p',1000000,1000000),
    ('ibc','packets','p',1000000,1000000),
    ('wasm','executions','p',1000000,1000000),
    ('wasm','contract_migrations','p',1000000,1000000),
    ('wasm','state_kv','p',1000000,1000000)
ON CONFLICT (schema_name, table_name) DO NOTHING;

-- 3) Bootstrap: create missing partitions up to target height or for a set number of steps
DO $$
    DECLARE
        v_steps int := COALESCE(NULLIF(current_setting('app.part.steps', true), '')::int, 0);
        v_target_height bigint := NULLIF(current_setting('app.part.target_height', true), '')::bigint;
        r RECORD;
        v_span bigint;
        v_cur  bigint;
        i int;
    BEGIN
        FOR r IN SELECT * FROM util.height_part_ranges LOOP
                IF v_target_height IS NOT NULL AND v_target_height > 0 THEN
                    SELECT current_to, span INTO v_cur, v_span
                    FROM util.height_part_ranges
                    WHERE schema_name=r.schema_name AND table_name=r.table_name;

                    WHILE v_cur < v_target_height LOOP
                            PERFORM util.ensure_next_height_partition(r.schema_name, r.table_name);
                            SELECT current_to INTO v_cur
                            FROM util.height_part_ranges
                            WHERE schema_name=r.schema_name AND table_name=r.table_name;
                        END LOOP;
                END IF;

                IF v_steps > 0 THEN
                    FOR i IN 1..v_steps LOOP
                            PERFORM util.ensure_next_height_partition(r.schema_name, r.table_name);
                        END LOOP;
                END IF;
            END LOOP;
    END$$;

-- 3b) Bootstrap hash partitions for core.events (configurable modulus and prefix)
DO $$
DECLARE
    v_modulus INT := COALESCE(NULLIF(current_setting('app.events.hash_modulus', true), '')::INT, 16);
    v_prefix  TEXT := COALESCE(NULLIF(current_setting('app.events.hash_prefix',  true), ''), 'h');
    v_has_children BOOLEAN;
BEGIN
    IF v_modulus IS NULL OR v_modulus < 1 THEN
        v_modulus := 16;
    END IF;

    SELECT EXISTS (
        SELECT 1
          FROM pg_inherits inh
          JOIN pg_class     parent ON parent.oid = inh.inhparent
          JOIN pg_namespace ns ON ns.oid = parent.relnamespace
         WHERE ns.nspname = 'core' AND parent.relname = 'events'
         LIMIT 1
    ) INTO v_has_children;

    IF NOT v_has_children THEN
        PERFORM util.ensure_hash_partitions('core', 'events', v_prefix, v_modulus);
    END IF;
END$$;

-- 4) Set autovacuum parameters for "hot" tables: apply only to leaf partitions
DO $$
    DECLARE
        base_tbl regclass;
        q text;
    BEGIN
        -- список корней, для которых хотим задать параметры
        FOR base_tbl IN
            SELECT 'core.transactions'::regclass
            UNION ALL SELECT 'core.events'::regclass
            UNION ALL SELECT 'core.event_attrs'::regclass
            LOOP
                -- обходим рекурсивно все наследники и выбираем только обычные таблицы (листья)
                FOR q IN
                    WITH RECURSIVE inh AS (
                        SELECT c.oid, c.relkind
                        FROM pg_class c
                        WHERE c.oid = base_tbl
                        UNION ALL
                        SELECT c2.oid, c2.relkind
                        FROM inh i
                                 JOIN pg_inherits pi ON pi.inhparent = i.oid
                                 JOIN pg_class c2 ON c2.oid = pi.inhrelid
                    )
                    SELECT format(
                                   'ALTER TABLE %s SET (%s);',
                                   oid::regclass,
                                   CASE WHEN base_tbl::text = 'core.transactions'
                                            THEN 'autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.02, autovacuum_vacuum_cost_limit=4000'
                                        ELSE 'autovacuum_vacuum_scale_factor=0.05, autovacuum_analyze_scale_factor=0.02'
                                   END
                           )
                    FROM inh
                    WHERE relkind = 'r'
                      AND oid <> base_tbl
                      AND NOT EXISTS (SELECT 1 FROM pg_inherits WHERE inhparent = inh.oid)
                    LOOP
                        BEGIN
                            EXECUTE q;  -- на случай старых версий/нестандартных билдов любые «не поддерживается» – игнорируем
                        EXCEPTION WHEN OTHERS THEN
                            NULL;
                        END;
                    END LOOP;
            END LOOP;
    END$$;

-- 5) Run ANALYZE on key tables (softly, ignore errors if any)
DO $$
    DECLARE
        t text;
    BEGIN
        FOREACH t IN ARRAY ARRAY['core.transactions','core.events','core.event_attrs'] LOOP
                BEGIN
                    EXECUTE format('ANALYZE %s;', t);
                EXCEPTION WHEN OTHERS THEN
                    NULL;
                END;
            END LOOP;
    END$$;

-- 6) Diagnostics: show partition counts and partition names for selected tables
SELECT r.schema_name||'.'||r.table_name AS table_name,
       COUNT(i.*) AS parts
FROM util.height_part_ranges r
         JOIN pg_class p ON p.relname = r.table_name
         JOIN pg_namespace ns ON ns.oid = p.relnamespace AND ns.nspname = r.schema_name
         LEFT JOIN pg_inherits i ON i.inhparent = p.oid
GROUP BY 1
ORDER BY 1;

SELECT c.relname AS event_partitions
FROM pg_inherits i
         JOIN pg_class c ON c.oid = i.inhrelid
         JOIN pg_class p ON p.oid = i.inhparent
         JOIN pg_namespace np ON np.oid = p.relnamespace
WHERE np.nspname='core' AND p.relname='events'
ORDER BY 1;

SELECT COUNT(*) AS events_hash_partitions
FROM pg_inherits i
       JOIN pg_class c ON c.oid = i.inhrelid
       JOIN pg_class p ON p.oid = i.inhparent
       JOIN pg_namespace np ON np.oid = p.relnamespace
WHERE np.nspname='core' AND p.relname='events';
-- =====================================================================