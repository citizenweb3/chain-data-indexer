# Production Handoff

## What Changed

- Upgraded Aztec dependencies to `4.1.1` across shared packages and services.
- Switched block transport from string serialization to hex-encoded block buffers.
- Updated explorer-api block storage from `header.contentCommitment` to `header.spongeBlobHash`.
- Added explorer-api DB migrations `0009_luxuriant_tomas.sql` and `0010_total_fees_mana_numeric.sql`.
- Added legacy HTTP compatibility for old `\/v1/{apiKey}\/l2/*` routes.

## Explorer Compatibility

- Existing root routes still work: `\/l2/*`.
- Legacy prefixed routes now also work again: `\/v1/<PUBLIC_API_KEY>/l2/*`.
- If the frontend reads standard block fields like `hash`, `height`, `finalizationStatus`, `txEffects`, contracts, tx effects, or stats, no change is required.
- If the frontend reads the deep block header field `header.contentCommitment`, the developer must switch to `header.spongeBlobHash`.

## Database Impact

- A clean reindex is not required.
- Existing `explorer_api` data can be migrated in place.
- The migration drops the obsolete `content_commitment` table and adds `header.sponge_blob_hash`.
- The migration also converts `header.total_fees` and `header.total_mana_used` to numeric columns.

## Deployment Files

- Main compose file: [docker-compose.indexer.yml](docker-compose.indexer.yml)
- Environment template: [.env.indexer.example](.env.indexer.example)
- Operational wrapper: [run-indexer.sh](run-indexer.sh)
- Operator runbook: [RUNBOOK.md](RUNBOOK.md)

## Production Restart

1. Copy the environment template.
2. Set `AZTEC_RPC_URLS`, `L2_NETWORK_ID`, and `PUBLIC_API_KEY`.
3. Run `./run-indexer.sh restart`.
4. Verify `./run-indexer.sh status`.
5. Verify API health on `http://<host>:8000/health`.

## Required Environment Values

- `NODE_ENV=production`
- `AZTEC_LISTENER_INSTANCE_NAME=<unique-name>`
- `EXPLORER_API_INSTANCE_NAME=<unique-name>`
- `AZTEC_RPC_URLS=name::https://your-rpc`
- `L2_NETWORK_ID=MAINNET|TESTNET|DEVNET|SANDBOX`
- `PUBLIC_API_KEY=<your-public-api-key>`

## Useful Commands

- Start: `./run-indexer.sh start`
- Restart: `./run-indexer.sh restart`
- Status: `./run-indexer.sh status`
- Logs: `./run-indexer.sh logs`
- API logs: `./run-indexer.sh logs api`
- Listener logs: `./run-indexer.sh logs listener`
- Render final compose config: `./run-indexer.sh config`

## Validation Performed

- `yarn install`
- `yarn build:packages`
- `cd services/aztec-listener && yarn build`
- `cd services/explorer-api && yarn build`
- `cd services/aztec-listener && yarn test-once`
- `cd packages/contract-verification && yarn test-once`

## Known Developer Note

- The contract-verification test suite is currently skipped by design. This is pre-existing and not caused by this upgrade.