FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
LABEL org.opencontainers.image.source="https://github.com/citizenweb3/chain-data-indexer"
WORKDIR /app
ENV NODE_ENV=production \
    API_PORT=8080 \
    INDEXER_HTTP_PORT=8080
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/proto ./proto
COPY --from=builder /app/initdb ./initdb
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 CMD wget -qO- "http://localhost:${API_PORT}/health" || exit 1
CMD ["node", "dist/index.js"]
