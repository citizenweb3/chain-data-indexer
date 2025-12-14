#!/bin/bash
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

COMPOSE_FILE="docker-compose.indexer.yml"
ENV_FILE=".env.indexer"

print_header() {
  echo -e "${BLUE}"
  echo "╔════════════════════════════════════════╗"
  echo "║        Aztec Blockchain Indexer        ║"
  echo "╚════════════════════════════════════════╝"
  echo -e "${NC}"
}

# Check env file
check_env() {
  if [ ! -f "$ENV_FILE" ]; then
    echo -e "${RED}Error: $ENV_FILE not found!${NC}"
    echo -e "${YELLOW}Create it from example:${NC}"
    echo "  cp .env.indexer.example .env.indexer"
    echo "  nano .env.indexer"
    exit 1
  fi
}

case "${1:-help}" in
  # ============================================
  # START - Build and start everything
  # ============================================
  start|up)
    print_header
    check_env
    echo -e "${YELLOW}Starting Aztec Indexer...${NC}"
    echo -e "${YELLOW}This may take a few minutes on first run (building images)...${NC}"
    echo ""

    docker-compose -f $COMPOSE_FILE --env-file $ENV_FILE up --build -d

    echo ""
    echo -e "${GREEN}======================================${NC}"
    echo -e "${GREEN}   Aztec Indexer is starting!${NC}"
    echo -e "${GREEN}======================================${NC}"
    echo ""
    echo -e "API will be available at: ${BLUE}http://localhost:8000/api/v1/dev/l2/${NC}"
    echo ""
    echo -e "Commands:"
    echo -e "  ${YELLOW}./run-indexer.sh logs${NC}      - View logs"
    echo -e "  ${YELLOW}./run-indexer.sh status${NC}    - Check status"
    echo -e "  ${YELLOW}./run-indexer.sh stop${NC}      - Stop indexer"
    ;;

  # ============================================
  # STOP - Stop all containers
  # ============================================
  stop|down)
    print_header
    echo -e "${YELLOW}Stopping Aztec Indexer...${NC}"
    docker-compose -f $COMPOSE_FILE down
    echo -e "${GREEN}Stopped!${NC}"
    ;;

  # ============================================
  # RESTART
  # ============================================
  restart)
    $0 stop
    $0 start
    ;;

  # ============================================
  # LOGS - View logs
  # ============================================
  logs)
    case "${2:-all}" in
      listener)
        docker-compose -f $COMPOSE_FILE logs -f aztec-listener
        ;;
      api)
        docker-compose -f $COMPOSE_FILE logs -f explorer-api
        ;;
      migrations)
        docker-compose -f $COMPOSE_FILE logs migrations
        ;;
      *)
        docker-compose -f $COMPOSE_FILE logs -f aztec-listener explorer-api
        ;;
    esac
    ;;

  # ============================================
  # STATUS - Show status
  # ============================================
  status)
    print_header
    echo -e "${YELLOW}Container Status:${NC}"
    docker-compose -f $COMPOSE_FILE ps
    echo ""

    # Check API
    API_KEY=$(grep -E "^API_KEYS=" $ENV_FILE 2>/dev/null | cut -d= -f2 | tr -d '"' | tr -d "'" || echo "dev")
    API_PORT=$(grep -E "^API_PORT=" $ENV_FILE 2>/dev/null | cut -d= -f2 || echo "8000")

    if curl -s "http://localhost:$API_PORT/api/v1/$API_KEY/l2/blocks?limit=1" > /dev/null 2>&1; then
      echo -e "${YELLOW}API:${NC} ${GREEN}OK${NC}"

      # Get stats
      STATS=$(curl -s "http://localhost:$API_PORT/api/v1/$API_KEY/l2/blocks?limit=1" 2>/dev/null)
      if [ -n "$STATS" ]; then
        echo -e "${YELLOW}Test query:${NC} curl http://localhost:$API_PORT/api/v1/$API_KEY/l2/blocks?limit=1"
      fi
    else
      echo -e "${YELLOW}API:${NC} ${RED}Not ready (may still be starting)${NC}"
    fi
    ;;

  # ============================================
  # RESET - Delete all data
  # ============================================
  reset)
    print_header
    echo -e "${RED}WARNING: This will delete ALL indexed data!${NC}"
    read -p "Are you sure? (y/N) " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      docker-compose -f $COMPOSE_FILE down -v
      echo -e "${GREEN}All data deleted!${NC}"
      echo -e "${YELLOW}Run './run-indexer.sh start' to start fresh.${NC}"
    fi
    ;;

  # ============================================
  # DEBUG - Start with Kafka UI
  # ============================================
  debug)
    print_header
    check_env
    echo -e "${YELLOW}Starting with Kafka UI for debugging...${NC}"
    docker-compose -f $COMPOSE_FILE --env-file $ENV_FILE --profile debug up --build -d
    echo -e "${GREEN}Kafka UI available at: http://localhost:8081${NC}"
    ;;

  # ============================================
  # HELP
  # ============================================
  *)
    print_header
    echo "Usage: ./run-indexer.sh <command>"
    echo ""
    echo "Commands:"
    echo "  start     Start the indexer (builds if needed)"
    echo "  stop      Stop all containers"
    echo "  restart   Restart all containers"
    echo "  status    Show container status"
    echo "  logs      View logs (logs listener|api|all)"
    echo "  reset     Delete all data and volumes"
    echo "  debug     Start with Kafka UI for debugging"
    echo ""
    echo "Quick start:"
    echo "  1. cp .env.indexer.example .env.indexer"
    echo "  2. Edit .env.indexer - set your AZTEC_RPC_URLS"
    echo "  3. ./run-indexer.sh start"
    echo ""
    echo "Example .env.indexer:"
    echo '  AZTEC_RPC_URLS=[{"name":"my-node","url":"http://your-aztec-rpc:8080"}]'
    echo "  API_KEYS=dev"
    ;;
esac
