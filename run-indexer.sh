#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.indexer.yml"
ENV_FILE="$ROOT_DIR/.env.indexer"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

ensure_env_file() {
  if [[ ! -f "$ENV_FILE" ]]; then
    cat >&2 <<EOF
Missing $ENV_FILE

Create it first:
  cp .env.indexer.example .env.indexer
  edit .env.indexer with your RPC URL and PUBLIC_API_KEY
EOF
    exit 1
  fi
}

service_alias() {
  case "${1:-}" in
    listener) echo "aztec-listener" ;;
    api) echo "explorer-api" ;;
    db|postgres) echo "postgres" ;;
    redis) echo "redis" ;;
    kafka) echo "kafka" ;;
    zookeeper) echo "zookeeper" ;;
    migrations) echo "migrations" ;;
    kafka-ui) echo "kafka-ui" ;;
    "") echo "" ;;
    *) echo "$1" ;;
  esac
}

usage() {
  cat <<EOF
Usage: ./run-indexer.sh <command> [service]

Commands:
  start       Build and start the stack in the background
  stop        Stop the stack
  restart     Restart the stack
  status      Show container status
  logs        Tail logs for all services or one service alias
  debug       Start the stack with Kafka UI profile enabled
  reset       Stop the stack and delete volumes
  config      Render the final docker compose configuration

Service aliases for logs:
  listener, api, db, redis, kafka, zookeeper, migrations, kafka-ui
EOF
}

command="${1:-}"
target_service="$(service_alias "${2:-}")"

case "$command" in
  start)
    ensure_env_file
    compose up --build -d
    ;;
  stop)
    ensure_env_file
    compose down --remove-orphans
    ;;
  restart)
    ensure_env_file
    compose down --remove-orphans
    compose up --build -d
    ;;
  status)
    ensure_env_file
    compose ps
    ;;
  logs)
    ensure_env_file
    if [[ -n "$target_service" ]]; then
      compose logs -f "$target_service"
    else
      compose logs -f
    fi
    ;;
  debug)
    ensure_env_file
    compose --profile debug up --build -d
    ;;
  reset)
    ensure_env_file
    compose down -v --remove-orphans
    ;;
  config)
    ensure_env_file
    compose config
    ;;
  *)
    usage
    exit 1
    ;;
esac