SHELL := /bin/bash

.PHONY: up down logs psql psql-file status

up:
	docker compose --env-file .env up -d db

down:
	docker compose --env-file .env down

reset:
	docker compose down -v && make up

logs:
	docker compose --env-file .env logs -f db

status:
	docker ps --filter "name=cosmosindexer"

psql:
	@docker exec -it cosmosindexer psql -U $${PG_USER:-cosmos_indexer_user} -d $${PG_DB:-cosmos_indexer_db}

# Usage: make psql-file FILE=path/to/script.sql
psql-file:
	@[ -n "$$FILE" ] || (echo "Usage: make psql-file FILE=path/to/script.sql" && exit 1)
	docker cp $$FILE cosmosindexer:/tmp/run.sql
	docker exec -e PGPASSWORD=$${PG_PASSWORD:-password} cosmosindexer bash -lc "psql -U $${PG_USER:-cosmos_indexer_user} -d $${PG_DB:-cosmos_indexer_db} -f /tmp/run.sql"
