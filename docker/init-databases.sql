-- Aztec Indexer - Database Initialization
-- This script runs automatically when PostgreSQL container starts for the first time

-- Create database for aztec-listener (stores processing heights, pending txs)
CREATE DATABASE aztec_listener;

-- Create database for explorer-api (stores all blockchain data)
CREATE DATABASE explorer_api;

-- Grant privileges
GRANT ALL PRIVILEGES ON DATABASE aztec_listener TO chicmoz;
GRANT ALL PRIVILEGES ON DATABASE explorer_api TO chicmoz;

-- Log success
DO $$
BEGIN
  RAISE NOTICE 'Databases created successfully: aztec_listener, explorer_api';
END $$;
