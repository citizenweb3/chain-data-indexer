#!/bin/bash
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}======================================${NC}"
echo -e "${YELLOW}   Aztec Indexer - Database Migrations${NC}"
echo -e "${YELLOW}======================================${NC}"

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Default values
POSTGRES_HOST=${POSTGRES_HOST:-localhost}
POSTGRES_PORT=${POSTGRES_PORT:-5432}
POSTGRES_USER=${POSTGRES_USER:-chicmoz}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-chicmoz123}
L2_NETWORK_ID=${L2_NETWORK_ID:-CUSTOM}

echo -e "${YELLOW}PostgreSQL: ${POSTGRES_HOST}:${POSTGRES_PORT}${NC}"

# Wait for PostgreSQL
echo -e "${YELLOW}Waiting for PostgreSQL...${NC}"
until PGPASSWORD=$POSTGRES_PASSWORD pg_isready -h "$POSTGRES_HOST" -p "$POSTGRES_PORT" -U "$POSTGRES_USER" 2>/dev/null; do
  echo -n "."
  sleep 2
done
echo -e "\n${GREEN}PostgreSQL is ready!${NC}"

# Build packages first (required for Drizzle)
echo -e "${YELLOW}Building packages...${NC}"
yarn build:packages
echo -e "${GREEN}Packages built!${NC}"

# Run migrations for aztec-listener
echo -e "${YELLOW}Running aztec-listener migrations...${NC}"
cd services/aztec-listener
yarn build
POSTGRES_HOST=$POSTGRES_HOST \
POSTGRES_PORT=$POSTGRES_PORT \
POSTGRES_USER=$POSTGRES_USER \
POSTGRES_PASSWORD=$POSTGRES_PASSWORD \
POSTGRES_DB=aztec_listener \
L2_NETWORK_ID=$L2_NETWORK_ID \
yarn migrate
echo -e "${GREEN}aztec-listener migrations complete!${NC}"

# Run migrations for explorer-api
echo -e "${YELLOW}Running explorer-api migrations...${NC}"
cd ../explorer-api
yarn build
POSTGRES_HOST=$POSTGRES_HOST \
POSTGRES_PORT=$POSTGRES_PORT \
POSTGRES_USER=$POSTGRES_USER \
POSTGRES_PASSWORD=$POSTGRES_PASSWORD \
POSTGRES_DB=explorer_api \
L2_NETWORK_ID=$L2_NETWORK_ID \
yarn migrate
echo -e "${GREEN}explorer-api migrations complete!${NC}"

cd ../..

echo -e "${GREEN}======================================${NC}"
echo -e "${GREEN}   All migrations completed!${NC}"
echo -e "${GREEN}======================================${NC}"
