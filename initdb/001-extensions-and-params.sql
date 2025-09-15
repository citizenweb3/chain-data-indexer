-- 001-extensions-and-params.sql
-- Runs automatically on first cluster init.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS btree_gin;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Optional: early tuning (safe defaults; adjust later in postgresql.conf if needed)
-- Note: in Docker official image, setting with ALTER SYSTEM writes to postgresql.auto.conf
DO $$ BEGIN
  PERFORM current_setting('shared_buffers');
EXCEPTION WHEN OTHERS THEN
  -- skip if not allowed
  RAISE NOTICE 'Skipping ALTER SYSTEM due to permissions.';
END $$;

-- You can uncomment and tailor these (example values):
-- ALTER SYSTEM SET shared_buffers = '1GB';
-- ALTER SYSTEM SET effective_cache_size = '3GB';
-- ALTER SYSTEM SET maintenance_work_mem = '512MB';
-- ALTER SYSTEM SET wal_compression = 'on';
-- ALTER SYSTEM SET autovacuum_naptime = '15s';
-- ALTER SYSTEM SET autovacuum_vacuum_scale_factor = 0.05;
-- SELECT pg_reload_conf();
