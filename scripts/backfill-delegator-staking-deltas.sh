#!/usr/bin/env bash
set -euo pipefail
cd /pool0/atomone-indexer
set -a; source .env; set +a

SQL_FILE=/pool0/atomone-indexer-api/docs/021-delegator-staking-deltas-refresh.sql
BOUNDS=(0 1000000 2000000 3000000 4000000 5000000 6000000 7000000 8000000 9000000 9535526)

for i in $(seq 0 9); do
  FROM=${BOUNDS[$i]}
  TO=${BOUNDS[$((i+1))]}
  echo "$(date -u +%FT%TZ) chunk ($FROM, $TO] starting"
  START=$(date +%s)
  docker exec -i -e PG_USER="$PG_USER" -e PG_DB="$PG_DB" atomoneindexer \
    psql -U "$PG_USER" -d "$PG_DB" --set=ON_ERROR_STOP=on \
    --set=last_watermark="$FROM" --set=new_watermark="$TO" \
    < "$SQL_FILE"
  END=$(date +%s)
  echo "$(date -u +%FT%TZ) chunk ($FROM, $TO] done in $((END-START))s"
done
echo "$(date -u +%FT%TZ) ALL_CHUNKS_DONE"
