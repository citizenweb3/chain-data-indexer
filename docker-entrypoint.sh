#!/usr/bin/env bash
set -euo pipefail

# Wait for Postgres to be available
host=${PG_HOST:-db}
# IMPORTANT: use the *container* Postgres port (5432) as default. The host may map the container port to a different external port (e.g. 2432),
# but inter-container networking should talk to the container's internal port.
port=${PG_PORT:-5432}
user=${PG_USER:-$PG_USER}
db=${PG_DB:-$PG_DB}

echo "[entrypoint] waiting for Postgres at ${host}:${port}..."

# simple wait loop
for i in {1..60}; do
  if pg_isready -h "$host" -p "$port" -U "${PG_USER}" >/dev/null 2>&1; then
    echo "[entrypoint] Postgres is ready"
    break
  fi
  echo "[entrypoint] still waiting... ($i)"
  sleep 1
done

# If asked to run a full reset on first start, we can detect emptiness of the schema
# Use a marker file in a volume to indicate reset already ran
marker="/tmp/cosmos-indexer-reset/.reset_done"
mkdir -p /tmp/cosmos-indexer-reset

# Check if schema/progress table exists in Postgres to detect first run. This is non-destructive.
if [ "${RESUME:-true}" = "true" ]; then
  echo "[entrypoint] RESUME=true: attempting to detect existing progress in DB"
  # Try to query for progress table
  if psql -h "$host" -p "$port" -U "$PG_USER" -d "$PG_DB" -c "SELECT 1 FROM pg_tables WHERE tablename='indexer_progress' LIMIT 1;" >/dev/null 2>&1; then
    echo "[entrypoint] progress table exists — container will start and resume indexing"
  else
    echo "[entrypoint] progress table not found — this looks like a fresh DB. Initial schema init will be performed by Postgres init scripts."
  fi
else
  echo "[entrypoint] RESUME not enabled; indexer will start from configured 'from' or 'first-block'"
fi

exec "$@"
