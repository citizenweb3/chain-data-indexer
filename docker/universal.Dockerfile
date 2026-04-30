# Universal Dockerfile for Aztec Indexer Services
# Supports: aztec-listener, explorer-api, migrations
# Usage: docker build --build-arg SERVICE=aztec-listener -f docker/universal.Dockerfile .

ARG NODE_VERSION=20
# NOTE: trixie (Debian 13 testing) is required because the native barretenberg (bb) binary
# bundled with @aztec/bb.js@2.1.2 requires GLIBC_2.38+/GLIBC_2.39+ and GLIBCXX_3.4.31+.
# bookworm (Debian 12 stable) only provides glibc 2.36, which is too old.
# trixie provides glibc 2.41 which satisfies all ABI requirements for bb.js native mode.
# Replace with a newer stable Debian/Ubuntu base once one with glibc >= 2.38 is available.
FROM node:${NODE_VERSION}-trixie-slim AS builder

WORKDIR /app

# Install build dependencies.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ postgresql-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn ./.yarn

# Copy ALL package.json files (required for yarn workspace resolution)
COPY packages/backend-utils/package.json ./packages/backend-utils/
COPY packages/error-middleware/package.json ./packages/error-middleware/
COPY packages/logger-server/package.json ./packages/logger-server/
COPY packages/message-bus/package.json ./packages/message-bus/
COPY packages/message-registry/package.json ./packages/message-registry/
COPY packages/metrics-server/package.json ./packages/metrics-server/
COPY packages/microservice-base/package.json ./packages/microservice-base/
COPY packages/postgres-helper/package.json ./packages/postgres-helper/
COPY packages/types/package.json ./packages/types/
COPY packages/redis-helper/package.json ./packages/redis-helper/
COPY packages/contract-verification/package.json ./packages/contract-verification/

# Copy only necessary service package.json files based on build arg
ARG SERVICE=aztec-listener
COPY services/aztec-listener/package.json ./services/aztec-listener/
COPY services/explorer-api/package.json ./services/explorer-api/

# Install dependencies
RUN yarn install

# Copy packages source
COPY packages ./packages

# Copy services source
COPY services/aztec-listener ./services/aztec-listener
COPY services/explorer-api ./services/explorer-api

# Build packages first
RUN yarn build:packages

# Build services (needed for migrations scripts)
RUN cd services/aztec-listener && yarn build
RUN cd services/explorer-api && yarn build

# ============================================
# Production image
# ============================================
# Keep in sync with builder stage — same glibc requirement.
FROM node:${NODE_VERSION}-trixie-slim AS runner

ARG SERVICE=aztec-listener
ENV SERVICE_NAME=${SERVICE}

WORKDIR /app

# Install runtime dependencies (wget for healthcheck, postgresql-client for migrations).
RUN apt-get update \
  && apt-get install -y --no-install-recommends wget postgresql-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Copy built artifacts
COPY --from=builder /app/package.json /app/yarn.lock /app/.yarnrc.yml ./
COPY --from=builder /app/.yarn ./.yarn
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages

# Copy services (only if not migrations)
RUN if [ "${SERVICE}" != "migrations" ]; then \
      mkdir -p ./services/${SERVICE}; \
    fi
COPY --from=builder /app/services ./services

# Copy migration script for migrations service
COPY docker/run-migrations-docker.sh /run-migrations.sh
RUN chmod +x /run-migrations.sh

# Set working directory based on service
RUN if [ "$SERVICE_NAME" = "migrations" ]; then \
      mkdir -p /app/migrations; \
    fi

WORKDIR /app

# Expose port (8000 for both services)
EXPOSE 8000

# Health check - works for both services
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${HEALTH_PORT:-8000}/health || exit 1

# Entry point depends on service type
CMD if [ "$SERVICE_NAME" = "migrations" ]; then \
      /run-migrations.sh; \
    else \
      cd services/${SERVICE_NAME} && node --enable-source-maps build/src/index.js; \
    fi
