-- =============================================================================
-- 010-readonly-api-role.sql
--
-- Bootstrap the read-only role used by AtomOne Indexer API.
--
-- This file is idempotent and safe to re-run for password rotation or for
-- re-granting privileges to newly created partitions/tables.
-- =============================================================================

\set ON_ERROR_STOP on

\if :{?api_ro_password}

SET cdi.api_ro_password TO :'api_ro_password';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atomone_api_ro') THEN
    EXECUTE format(
      'CREATE ROLE atomone_api_ro LOGIN PASSWORD %L',
      current_setting('cdi.api_ro_password')
    );
  ELSE
    EXECUTE format(
      'ALTER ROLE atomone_api_ro WITH LOGIN PASSWORD %L',
      current_setting('cdi.api_ro_password')
    );
  END IF;
END $$;

RESET cdi.api_ro_password;

ALTER ROLE atomone_api_ro SET default_transaction_read_only = on;
ALTER ROLE atomone_api_ro SET statement_timeout = '30s';
ALTER ROLE atomone_api_ro SET idle_in_transaction_session_timeout = '60s';
ALTER ROLE atomone_api_ro CONNECTION LIMIT 30;

DO $$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO atomone_api_ro', current_database());
END $$;

DO $$
DECLARE
  schema_name text;
BEGIN
  FOREACH schema_name IN ARRAY ARRAY[
    'core', 'bank', 'stake', 'gov', 'ibc',
    'wasm', 'authz_feegrant', 'groups', 'tokens', 'analytics'
  ]
  LOOP
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO atomone_api_ro', schema_name);
    EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA %I TO atomone_api_ro', schema_name);
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE atomone_indexer_user IN SCHEMA %I ' ||
      'GRANT SELECT ON TABLES TO atomone_api_ro',
      schema_name
    );
  END LOOP;
END $$;

\else
\echo 'api_ro_password not set; skipping atomone_api_ro bootstrap'
\endif

DO $$
BEGIN
  EXECUTE format('REVOKE CREATE ON DATABASE %I FROM PUBLIC', current_database());
END $$;
