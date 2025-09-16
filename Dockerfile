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
COPY package.json package-lock.json* ./
RUN npm install --package-lock-only --ignore-scripts
# Install dependencies
RUN npm ci --omit=dev

# Copy rest of the source
COPY . .

# Ensure entrypoint is executable
RUN chmod +x ./docker-entrypoint.sh

# Build typescript (if project uses tsc build script)
RUN npm run build || true

# (run as root inside container to avoid permission issues for out-of-app paths)

ENV NODE_ENV=production
EXPOSE 3000

ENTRYPOINT ["/bin/bash", "./docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
