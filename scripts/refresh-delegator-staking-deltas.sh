#!/usr/bin/env bash
# Incremental refresh of stake.delegator_staking_deltas / stake.delegator_staking_delta_stats.
# Intended to run periodically via cron against the atomone producer database. Idempotent:
# reruns for the same height window are no-ops (ON_CONFLICT DO NOTHING on the deltas table).
set -euo pipefail

# Source the producer indexer's env for PG_USER/PG_DB so this runs unattended from cron,
# which does not inherit an interactive shell's exported variables.
INDEXER_ENV="${INDEXER_ENV:-/pool0/atomone-indexer/.env}"
if [ -f "$INDEXER_ENV" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$INDEXER_ENV"
  set +a
fi

PG_CONTAINER="${PG_CONTAINER:-atomoneindexer}"
PG_USER="${PG_USER:?PG_USER env var required (set directly or via INDEXER_ENV)}"
PG_DB="${PG_DB:?PG_DB env var required (set directly or via INDEXER_ENV)}"
SQL_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/docs/021-delegator-staking-deltas-refresh.sql"

read_scalar() {
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -t -A -c "$1" | tr -d '[:space:]'
}

LAST_WATERMARK=$(read_scalar "SELECT last_indexed_height FROM stake.staking_deltas_refresh_state WHERE id = true;")
NEW_WATERMARK=$(read_scalar "SELECT max(height) FROM core.blocks;")

if [ -z "$NEW_WATERMARK" ] || [ "$NEW_WATERMARK" -le "$LAST_WATERMARK" ]; then
  echo "$(date -u +%FT%TZ) refresh-delegator-staking-deltas: nothing to do (last=$LAST_WATERMARK new=$NEW_WATERMARK)"
  exit 0
fi

echo "$(date -u +%FT%TZ) refresh-delegator-staking-deltas: processing ($LAST_WATERMARK, $NEW_WATERMARK]"
docker exec -i "$PG_CONTAINER" \
  psql -U "$PG_USER" -d "$PG_DB" --set=ON_ERROR_STOP=on \
  --set=last_watermark="$LAST_WATERMARK" --set=new_watermark="$NEW_WATERMARK" \
  < "$SQL_FILE"
echo "$(date -u +%FT%TZ) refresh-delegator-staking-deltas: done, watermark now $NEW_WATERMARK"
