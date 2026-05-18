SHELL := /bin/bash

.PHONY: up down logs psql psql-file status rebuild-heavy-indexes

up:
	docker compose --env-file .env up -d db

down:
	docker compose --env-file .env down

reset:
	docker compose down -v && make up

logs:
	docker compose --env-file .env logs -f db

status:
	docker ps --filter "name=atomoneindexer"

psql:
	@docker exec -it atomoneindexer psql -U $${PG_USER:-atomone_indexer_user} -d $${PG_DB:-atomone_indexer_db}

# Usage: make psql-file FILE=path/to/script.sql
psql-file:
	@[ -n "$$FILE" ] || (echo "Usage: make psql-file FILE=path/to/script.sql" && exit 1)
	docker cp $$FILE atomoneindexer:/tmp/run.sql
	docker exec -e PGPASSWORD=$${PG_PASSWORD:-password} atomoneindexer bash -lc "psql -U $${PG_USER:-atomone_indexer_user} -d $${PG_DB:-atomone_indexer_db} -f /tmp/run.sql"

# Rebuild heavy secondary indexes skipped during bulk backfill init.
rebuild-heavy-indexes:
	docker cp scripts/rebuild-heavy-indexes.sql atomoneindexer:/tmp/rebuild-heavy-indexes.sql
	docker exec -e PGPASSWORD=$${PG_PASSWORD:-password} atomoneindexer bash -lc "psql -v ON_ERROR_STOP=1 -U $${PG_USER:-atomone_indexer_user} -d $${PG_DB:-atomone_indexer_db} -f /tmp/rebuild-heavy-indexes.sql"
