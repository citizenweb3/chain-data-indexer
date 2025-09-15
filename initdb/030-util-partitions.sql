-- 030-util-partitions.sql

-- Schema for utility functions and tables related to partition management
CREATE SCHEMA IF NOT EXISTS util;

-- Table to store partition range configurations for tables partitioned by height
CREATE TABLE IF NOT EXISTS util.height_part_ranges (
    schema_name   TEXT NOT NULL,
    table_name    TEXT NOT NULL,
    part_prefix   TEXT NOT NULL,
    span          BIGINT NOT NULL DEFAULT 1000000,
    current_to    BIGINT NOT NULL DEFAULT 1000000,
    PRIMARY KEY (schema_name, table_name)
);

-- Function to create the next height-based partition for a given table if it does not exist
CREATE OR REPLACE FUNCTION util.ensure_next_height_partition(p_schema TEXT, p_table TEXT)
RETURNS VOID LANGUAGE plpgsql AS $$
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
    part_name := format('%I.%I_%s%s', p_schema, p_table, cfg.part_prefix, (from_h::text));

    IF EXISTS (
        SELECT 1
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = p_schema
          AND c.relname = p_table || '_' || cfg.part_prefix || from_h::text
    ) THEN
        RETURN;
    END IF;

    sql := format($fmt$
        CREATE TABLE IF NOT EXISTS %s
        PARTITION OF %I.%I
        FOR VALUES FROM (%s) TO (%s)
    $fmt$, part_name, p_schema, p_table, from_h, to_h);

    EXECUTE sql;

    UPDATE util.height_part_ranges
       SET current_to = to_h
     WHERE schema_name = p_schema AND table_name = p_table;
END$$;

-- Seed partition range configurations for common tables (idempotent insert)
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
