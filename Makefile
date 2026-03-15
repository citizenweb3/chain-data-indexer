SHELL := /bin/bash

.PHONY: up up-clickhouse down logs clickhouse-logs psql psql-file clickhouse-client status rebuild-heavy-indexes

up:
	docker compose --env-file .env up -d db

up-clickhouse:
	docker compose --env-file .env --profile clickhouse up -d clickhouse indexer-clickhouse

down:
	docker compose --env-file .env down

reset:
	docker compose down -v && make up

logs:
	docker compose --env-file .env logs -f db

clickhouse-logs:
	docker compose --env-file .env --profile clickhouse logs -f clickhouse indexer-clickhouse

status:
	docker compose --env-file .env ps

psql:
	@docker exec -it cosmosindexer psql -U $${PG_USER:-cosmos_indexer_user} -d $${PG_DB:-cosmos_indexer_db}

# Usage: make psql-file FILE=path/to/script.sql
psql-file:
	@[ -n "$$FILE" ] || (echo "Usage: make psql-file FILE=path/to/script.sql" && exit 1)
	docker cp $$FILE cosmosindexer:/tmp/run.sql
	docker exec -e PGPASSWORD=$${PG_PASSWORD:-password} cosmosindexer bash -lc "psql -U $${PG_USER:-cosmos_indexer_user} -d $${PG_DB:-cosmos_indexer_db} -f /tmp/run.sql"

clickhouse-client:
	@docker exec -it cosmosindexer-clickhouse clickhouse-client --user $${CH_USERNAME:-default} --password "$${CH_PASSWORD:-password}" --database $${CH_DATABASE:-default}

# Rebuild heavy secondary indexes skipped during bulk backfill init.
rebuild-heavy-indexes:
	docker cp scripts/rebuild-heavy-indexes.sql cosmosindexer:/tmp/rebuild-heavy-indexes.sql
	docker exec -e PGPASSWORD=$${PG_PASSWORD:-password} cosmosindexer bash -lc "psql -v ON_ERROR_STOP=1 -U $${PG_USER:-cosmos_indexer_user} -d $${PG_DB:-cosmos_indexer_db} -f /tmp/rebuild-heavy-indexes.sql"
