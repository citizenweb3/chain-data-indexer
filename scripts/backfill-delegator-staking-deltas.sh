#!/usr/bin/env bash
# One-time chunked backfill of stake.delegator_staking_deltas / _stats for the cosmos
# producer database. Runs docs/021-delegator-staking-deltas-refresh.sql once per height
# chunk, each in its own transaction. Chunk boundaries come from the driving partitioned
# table's own relpartbound (never hardcode round numbers) and the final chunk ends at the
# current tip so the refresh cron picks up seamlessly. Idempotent: reruns are no-ops
# (ON CONFLICT DO NOTHING on the deltas table); resumable via the watermark row.
#
# Prereq: docs/020-delegator-staking-deltas-schema.sql already applied.
set -euo pipefail

PG_CONTAINER="${PG_CONTAINER:-cosmosindexer}"
PG_USER="${PG_USER:-cosmos_indexer_user}"
PG_DB="${PG_DB:-cosmos_indexer_db}"
DRIVING_TABLE="${DRIVING_TABLE:-stake.delegation_events}"
SQL_FILE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/docs/021-delegator-staking-deltas-refresh.sql"

scalar() {
  docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tA -c "$1" | tr -d '[:space:]'
}

run_chunk() {
  local from=$1 to=$2 start
  echo "$(date -u +%FT%TZ) chunk ($from, $to] starting"
  start=$(date +%s)
  docker exec -i "$PG_CONTAINER" \
    psql -U "$PG_USER" -d "$PG_DB" --set=ON_ERROR_STOP=on \
    --set=last_watermark="$from" --set=new_watermark="$to" \
    < "$SQL_FILE"
  echo "$(date -u +%FT%TZ) chunk ($from, $to] done in $(( $(date +%s) - start ))s"
}

# Interior boundaries = partition upper bounds of the driving table, straight from relpartbound.
mapfile -t BOUNDS < <(docker exec -i "$PG_CONTAINER" psql -U "$PG_USER" -d "$PG_DB" -tA -c "
  SELECT (regexp_replace(pg_get_expr(c.relpartbound, c.oid), '.*TO \(''?([0-9]+)''?\).*', '\1'))::bigint AS upper
  FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
  WHERE i.inhparent = '${DRIVING_TABLE}'::regclass
  ORDER BY upper;")

TIP=$(scalar "SELECT max(height) FROM core.blocks;")
if [ -z "${TIP:-}" ]; then echo "could not read tip height" >&2; exit 1; fi
echo "$(date -u +%FT%TZ) backfill start: ${#BOUNDS[@]} partition bounds, tip=$TIP"

lower=0
for upper in "${BOUNDS[@]}"; do
  if [ "$upper" -ge "$TIP" ]; then break; fi
  run_chunk "$lower" "$upper"
  lower="$upper"
done
run_chunk "$lower" "$TIP"

echo "$(date -u +%FT%TZ) ALL_CHUNKS_DONE (watermark now $TIP)"
