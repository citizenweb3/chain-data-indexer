# Explorer API Dockerfile
FROM node:18-alpine AS builder

WORKDIR /app

# Install build dependencies
RUN apk add --no-cache python3 make g++

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

# Copy explorer-api service
COPY services/explorer-api ./services/explorer-api

# Build packages first
RUN yarn build:packages

# Build explorer-api
RUN cd services/explorer-api && yarn build

# ============================================
# Production image
# ============================================
FROM node:18-alpine AS runner

WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/package.json /app/yarn.lock /app/.yarnrc.yml ./
COPY --from=builder /app/.yarn ./.yarn
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/services/explorer-api ./services/explorer-api

WORKDIR /app/services/explorer-api

# Expose API port
EXPOSE 8000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT:-8000}/health || exit 1

CMD ["yarn", "start"]