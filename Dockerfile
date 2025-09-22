# Use Debian-based Node 22 to match local runtime and avoid musl/glibc/native binary issues
FROM node:22-bullseye

# Create app directory
WORKDIR /usr/src/app

# Install build deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    bash \
    git \
    python3 \
    build-essential \
    ca-certificates \
    postgresql-client \
    && rm -rf /var/lib/apt/lists/*

# Copy package manifests first to install deps (leverage caching)
COPY package.json yarn.lock* ./

# Install dependencies using yarn (matching local setup)
RUN yarn install --frozen-lockfile --production

# Copy environment file
COPY .env.example .env

# Copy rest of the source
COPY . .

# Ensure entrypoint is executable
RUN chmod +x ./docker-entrypoint.sh

# Generate TypeScript artifacts required at runtime (knownMsgs.ts)
RUN npx tsx scripts/gen-known-msgs.ts || true

# Build typescript (if project uses build script)
RUN yarn build || true

# Set production environment
ENV NODE_ENV=production

EXPOSE 3000

ENTRYPOINT ["/bin/bash", "./docker-entrypoint.sh"]
CMD ["yarn", "start"]