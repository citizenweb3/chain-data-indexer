# Indexer Runbook

## Scope

This runbook is for starting, verifying, restarting, and troubleshooting the Dockerized Aztec indexer stack in this repository.

Verified stack components:

- `postgres`
- `redis`
- `zookeeper`
- `kafka`
- `migrations`
- `aztec-listener`
- `explorer-api`

## Verified Runtime Result

During the last smoke-test:

- `aztec-listener` became healthy and published catchup block events.
- `explorer-api` became healthy and served both root and legacy API routes.
- `explorer_api` database received indexed data.
- Observed lower-bound ingestion speed into `explorer_api`: about `16 blocks/sec`.

Why this is a lower bound:

- The measurement was taken from a smoke-test, not a clean benchmark harness.
- The figure is based on `678` stored `l2Block` rows roughly `42` seconds after `explorer-api` container start.
- Listener-side catchup was ahead of API consumption, so source polling was not the limiting step.

## Prerequisites

- Docker with Compose support
- A working Aztec RPC endpoint
- Enough free disk space for a full image build

## Environment Setup

1. Create the runtime env file:

```bash
cp .env.indexer.example .env.indexer
```

2. Set at minimum:

```bash
AZTEC_RPC_URLS=mainnet::https://your-rpc
L2_NETWORK_ID=MAINNET
NODE_ENV=production
AZTEC_LISTENER_INSTANCE_NAME=aztec-listener-1
EXPLORER_API_INSTANCE_NAME=explorer-api-1
PUBLIC_API_KEY=dev-api-key
POSTGRES_USER=chicmoz
POSTGRES_PASSWORD=strong-password
```

3. Leave Redis pointed at the bundled service unless you intentionally use an external cache:

```bash
REDIS_HOST=redis
REDIS_PORT=6379
```

## Start

Use the wrapper script:

```bash
./run-indexer.sh start
```

For a full restart:

```bash
./run-indexer.sh restart
```

## Expected Service State

Check status:

```bash
./run-indexer.sh status
```

Expected result:

- `postgres` is `healthy`
- `redis` is `healthy`
- `zookeeper` is `healthy`
- `kafka` is `healthy`
- `aztec-listener` is `healthy`
- `explorer-api` is `healthy`
- `migrations` exits successfully once and does not keep running

Note: the migrations container is a one-shot task. `Exited (0)` is the expected outcome.

## HTTP Verification

Health endpoint:

```bash
curl http://localhost:8000/health
```

Expected result:

```json
{}
```

Legacy prefixed API index:

```bash
curl http://localhost:8000/v1/dev-api-key/l2/index
```

Root-mounted API index:

```bash
curl http://localhost:8000/l2/index
```

Latest indexed block:

```bash
curl http://localhost:8000/v1/dev-api-key/l2/blocks/latest
```

Expected signal:

- HTTP `200`
- JSON payload with a block object
- block header contains `spongeBlobHash`

## Log Verification

Listener logs:

```bash
./run-indexer.sh logs listener
```

Healthy listener signals include lines like:

- `Calling Aztec node function: getBlock`
- `Publishing message to topic MAINNET__CATCHUP_BLOCK_EVENT`
- `catchup proven block <n>`

API logs:

```bash
./run-indexer.sh logs api
```

Healthy API signals include lines like:

- `Catchup block event`
- `Parsing block <n>`
- `Storing block <n>`
- `GET /health 200`

## Database Verification

To confirm blocks are actually being stored:

```bash
docker exec aztec-indexer-postgres \
  psql -U "$POSTGRES_USER" -d explorer_api \
  -c 'select count(*) as blocks, max(height) as max_height from "l2Block";'
```

To confirm transaction effects are being stored:

```bash
docker exec aztec-indexer-postgres \
  psql -U "$POSTGRES_USER" -d explorer_api \
  -c 'select count(*) as tx_effects from tx_effect;'
```

## Restart Procedure

Normal restart:

```bash
./run-indexer.sh restart
```

Then re-check:

```bash
./run-indexer.sh status
curl http://localhost:8000/health
curl http://localhost:8000/v1/dev-api-key/l2/blocks/latest
```

## Troubleshooting

### `explorer-api` restart loop

Check:

```bash
docker logs --tail 200 aztec-indexer-api
```

Important known causes that are already fixed in the current repo state:

- Alpine-based runtime images breaking `@aztec/bb.js` native execution
- missing Redis service in Compose
- `REDIS_PORT` parsing as a string instead of a number

If you see these symptoms again, rebuild from current sources:

```bash
./run-indexer.sh restart
```

### API is up but no data appears

Check listener logs first. If listener is not publishing catchup events, the API has nothing to consume.

Also verify:

- `AZTEC_RPC_URLS` points to a live node
- `KAFKA_CONNECTION` resolves inside Docker
- `postgres` and `kafka` are healthy

### Old explorer integration breaks

Route compatibility is preserved for:

- `/v1/<PUBLIC_API_KEY>/l2/*`
- `/l2/*`

Payload caveat:

- old field `header.contentCommitment` no longer exists
- use `header.spongeBlobHash` instead

## Stop

```bash
./run-indexer.sh stop
```

## Full Cleanup

For local retests on a disk-constrained machine, remove everything:

```bash
docker compose --env-file "$PWD/.env.indexer" -f docker-compose.indexer.yml down -v --remove-orphans
docker system prune -af --volumes
```

Use this only when you intentionally want to delete containers, images, volumes, and build cache.