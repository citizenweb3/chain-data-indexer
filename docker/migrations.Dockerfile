# Migrations Dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++ postgresql-client

# Copy package files
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn

# Copy ALL package.json files (required for yarn workspace resolution)
COPY packages/backend-utils/package.json ./packages/backend-utils/
COPY packages/error-middleware/package.json ./packages/error-middleware/
COPY packages/logger-server/package.json ./packages/logger-server/
COPY packages/message-bus/package.json ./packages/message-bus/
COPY packages/message-registry/package.json ./packages/message-registry/
COPY packages/microservice-base/package.json ./packages/microservice-base/
COPY packages/postgres-helper/package.json ./packages/postgres-helper/
COPY packages/types/package.json ./packages/types/
COPY packages/auth0-middleware/package.json ./packages/auth0-middleware/
COPY packages/redis-helper/package.json ./packages/redis-helper/
COPY packages/contract-verification/package.json ./packages/contract-verification/

COPY services/aztec-listener/package.json ./services/aztec-listener/
COPY services/explorer-api/package.json ./services/explorer-api/
COPY services/auth/package.json ./services/auth/
COPY services/ethereum-listener/package.json ./services/ethereum-listener/
COPY services/event-cannon/package.json ./services/event-cannon/
COPY services/explorer-ui/package.json ./services/explorer-ui/
COPY services/websocket-event-publisher/package.json ./services/websocket-event-publisher/

# Install dependencies
RUN yarn install

# Copy packages source
COPY packages ./packages

# Copy services source (only what we need)
COPY services/aztec-listener ./services/aztec-listener
COPY services/explorer-api ./services/explorer-api

# Build packages
RUN yarn build:packages

# Build services (required for Drizzle migrations)
RUN cd services/aztec-listener && yarn build
RUN cd services/explorer-api && yarn build

# ============================================
# Migration runner
# ============================================
FROM node:18-alpine AS runner

WORKDIR /app

# Install PostgreSQL client for health checks
RUN apk add --no-cache postgresql-client

# Copy built artifacts
COPY --from=builder /app/package.json /app/yarn.lock /app/.yarnrc.yml ./
COPY --from=builder /app/.yarn ./.yarn
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services/aztec-listener ./services/aztec-listener
COPY --from=builder /app/services/explorer-api ./services/explorer-api

# Copy migration script
COPY docker/run-migrations-docker.sh /run-migrations.sh
RUN chmod +x /run-migrations.sh

ENTRYPOINT ["/run-migrations.sh"]