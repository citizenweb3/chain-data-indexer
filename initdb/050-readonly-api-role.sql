-- =============================================================================
-- 050-readonly-api-role.sql
--
-- Bootstrap the read-only role used by cosmos-indexer-api.
--
-- This file is idempotent and safe to re-run. It is shipped both as part of
-- docker-entrypoint-initdb.d (for fresh DB bootstrap) and applied manually to
-- existing live databases via:
--
--   PASSWORD=$(openssl rand -base64 48 | tr -d '/+=' | head -c 48)
--   docker cp initdb/050-readonly-api-role.sql cosmosindexer:/tmp/050.sql
--   docker exec -e PGPASSWORD="$PG_PASSWORD" cosmosindexer \
--     psql -U cosmos_indexer_user -d cosmos_indexer_db -v ON_ERROR_STOP=1 \
--          -v api_ro_password="$PASSWORD" -f /tmp/050.sql
--
-- The password is supplied via a psql variable (`:'api_ro_password'`) so it
-- never lives in source control. Store the generated value in
-- /pool0/cosmos-indexer-api/.api-ro.password (mode 600).
--
-- The cosmos_api_ro role is granted SELECT only. The per-role settings are
-- defence-in-depth measures that protect the *indexer* from a misbehaving
-- API (runaway query holding snapshots blocks autovacuum, leaked transactions
-- block VACUUM, leaked connections exhaust max_connections). They are not
-- about throttling end users.
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?api_ro_password}

-- The password arrives as psql variable :api_ro_password. Promote it to a
-- session-scoped GUC so plpgsql DO blocks can read it via current_setting().
-- (PostgreSQL 14+ accepts any namespaced custom GUC without prior declaration.)
SET cdi.api_ro_password TO :'api_ro_password';

-- Idempotent: create role if missing, otherwise rotate its password.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cosmos_api_ro') THEN
    EXECUTE format(
      'CREATE ROLE cosmos_api_ro LOGIN PASSWORD %L',
      current_setting('cdi.api_ro_password')
    );
  ELSE
    EXECUTE format(
      'ALTER ROLE cosmos_api_ro WITH LOGIN PASSWORD %L',
      current_setting('cdi.api_ro_password')
    );
  END IF;
END $$;

-- Wipe the GUC so the password does not linger in the session.
RESET cdi.api_ro_password;

-- Hard safety net: even if grants are accidentally widened later, cosmos_api_ro
-- physically cannot start a writable transaction.
ALTER ROLE cosmos_api_ro SET default_transaction_read_only = on;

-- Cap a single statement at 30s. A runaway SELECT under MVCC keeps a snapshot
-- open and blocks autovacuum on the same partitions the indexer is writing to.
ALTER ROLE cosmos_api_ro SET statement_timeout = '30s';

-- Cap idle-in-transaction at 60s. A leaked transaction (forgotten ROLLBACK)
-- holds the same snapshot and prevents VACUUM from reclaiming dead tuples.
ALTER ROLE cosmos_api_ro SET idle_in_transaction_session_timeout = '60s';

-- Limit connections so a connection-leak bug in the API cannot exhaust the
-- 500-slot max_connections pool and lock the indexer out of new connections.
ALTER ROLE cosmos_api_ro CONNECTION LIMIT 30;

-- Allow the role to attach to the current database. This keeps the script safe
-- for isolated test databases while preserving the same effect in production.
DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO cosmos_api_ro', current_database());
END $$;

-- Grant SELECT on every domain schema and ensure future tables/partitions
-- inherit the same privilege automatically. The indexer creates new range
-- partitions every day; without ALTER DEFAULT PRIVILEGES the API would
-- silently lose access to recent blocks/events.
DO $$
DECLARE
  s text;
BEGIN
  FOREACH s IN ARRAY ARRAY[
    'core', 'bank', 'stake', 'gov', 'ibc',
    'wasm', 'authz_feegrant', 'groups', 'tokens', 'analytics'
  ]
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO cosmos_api_ro', s);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO cosmos_api_ro', s);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE cosmos_indexer_user IN SCHEMA %I '
      'GRANT SELECT ON TABLES TO cosmos_api_ro',
      s
    );
  END LOOP;
END $$;

\else
\echo 'api_ro_password not set; skipping cosmos_api_ro bootstrap'
\endif

-- Tighten public schema usage; PUBLIC must not be allowed to create objects.
DO $$
BEGIN
  EXECUTE format('REVOKE CREATE ON DATABASE %I FROM PUBLIC', current_database());
END $$;
