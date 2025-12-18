#!/bin/sh
set -e

echo "========================================"
echo "   Aztec Indexer - Database Migrations"
echo "========================================"

# Wait for PostgreSQL
echo "Waiting for PostgreSQL at ${POSTGRES_HOST}:${POSTGRES_PORT}..."
until pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" 2>/dev/null; do
  echo -n "."
  sleep 2
done
echo ""
echo "PostgreSQL is ready!"

# Run migrations for aztec-listener
echo "Running aztec-listener migrations..."
cd /app/services/aztec-listener
POSTGRES_IP="$POSTGRES_HOST" \
POSTGRES_PORT="$POSTGRES_PORT" \
POSTGRES_ADMIN="$POSTGRES_USER" \
POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
POSTGRES_DB_NAME=aztec_listener \
yarn migrate
echo "aztec-listener migrations complete!"

# Run migrations for explorer-api
echo "Running explorer-api migrations..."
cd /app/services/explorer-api
POSTGRES_IP="$POSTGRES_HOST" \
POSTGRES_PORT="$POSTGRES_PORT" \
POSTGRES_ADMIN="$POSTGRES_USER" \
POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
POSTGRES_DB_NAME=explorer_api \
yarn migrate
echo "explorer-api migrations complete!"

echo "========================================"
echo "   All migrations completed!"
echo "========================================"
