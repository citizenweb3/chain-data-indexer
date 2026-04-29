# AGENTS.md — Miden indexer operating context

## Mission

This branch implements the Miden L2 indexer. Live target: `miden-node 0.13.4` (proto in `proto/`).

The indexer follows a live Miden node over public gRPC, persists explorer-visible data in Postgres, and serves a read-only HTTP API for block-explorer consumers.

## Repo conventions

- This repository is a branch-per-network monorepo. Network branches are intentionally independent, for example `logos-indexer-v0.1.2` and `miden-indexer-v0.13.4`.
- The current branch is the Miden branch for `miden-node 0.13.4`.
- Do **not** cross-port code, schema, Docker, or documentation from `main` or another network branch without explicit instruction.
- Treat Miden-specific protocol facts as branch-local facts. Logos/Namada/other-network assumptions do not apply here.

## Don't-touch list

- `proto/` — upstream pin for `miden-node 0.13.4`; bump only on an explicit version-upgrade task.
- `docs/api.md`, `docs/data-model.md`, `docs/schema.md` — truth sources; coordinate any change with a research subagent.
- `initdb/001-schema.sql` — shipped base schema; after release, use additive migrations only and do not destructively edit existing columns.

## Architecture map

- `src/config.ts` exports `config` and `Config`; it validates runtime environment with zod and owns defaults for node, Postgres, runner, HTTP, and logging settings.
- `src/rpc/client.ts` exports `MidenRpcClient` and `createMidenRpcClient`; it loads `proto/proto/rpc.proto`, wraps public unary gRPC methods, retries transient gRPC failures, converts wire digests/accounts to Buffers, and warns that `SyncState` v0.13.4 ignores nullifier prefixes.
- `src/rpc/types.ts` exports RPC-layer TypeScript types matching `miden-node 0.13.4` lower-camel proto-loader output; `src/rpc/digest.ts` owns digest/account hex and felt-lane conversion helpers.
- `src/sink/postgres.ts` exports `processBlock`, `processBatch`, and row types; it inserts block bundles and optional full-scope rows into Postgres, derives `block_hash` as `SHA-256(raw_block_bytes)`, and updates progress with `GREATEST`.
- `src/runner/index.ts`, `src/runner/syncRange.ts`, and `src/runner/follow.ts` export `startRunner`, `syncRange`, and `startFollow`; they choose a start block, fetch headers plus raw blocks, use bounded concurrency, backfill to tip, then poll-follow.
- `src/api.ts` exports `createApiServer` and `startApiServer`; it serves `/health` and read-only `/api/v1/*` explorer endpoints from Postgres, hex-encodes `BYTEA`, paginates list endpoints, and returns stable error bodies.
- `src/db/pg.ts` exports `getPool`, `withTx`, and `closePool`; `src/db/progress.ts` exports `getLastBlock` and `setLastBlock` using the singleton `miden_indexer_progress` row.
- `src/utils/logger.ts` exports the Winston `logger`; `src/utils/retry.ts` exports `withRetry` for retryable network/5xx/429 failures.

## Live deps

- Host `miden-node` public gRPC: `127.0.0.1:57291`.
- Postgres: whatever the deployment dictates (`DATABASE_URL` or `PG_HOST`/`PG_PORT`/`PG_DB`/`PG_USER`/`PG_PASSWORD`).

## Confidence guard

Every change must satisfy:

1. Fields/methods exist in `proto/` (not assumed from generic Miden knowledge).
2. `npm run build` is green.
3. For sink/runner changes: idempotent re-run produces no new rows; progress monotonic via `GREATEST`.
4. No secrets in diff.

## How to add a new RPC method

1. Confirm the method, request, response, and field names in `proto/proto/rpc.proto` and imported files under `proto/proto/types/`.
2. Add or extend typed request/response shapes in `src/rpc/types.ts`; keep lower-camel field names because proto-loader is configured that way.
3. Add a typed wrapper and wire encoder/decoder in `src/rpc/client.ts`; do not expose raw `unknown` beyond the client boundary.
4. Add a smoke call or focused assertion in `scripts/smoke-rpc.ts` against `127.0.0.1:57291` when the method is read-only. Do not invoke write endpoints unless explicitly instructed.
5. Document the method and live verification result in `docs/api.md`.
6. Run `npm run build`; run the relevant smoke script if live dependencies are available.

## How to add a new column

1. Add an additive migration file such as `initdb/002-add-example-column.sql`; do not destructively edit `initdb/001-schema.sql` after it is shipped.
2. Make the new column `NULLABLE` on add unless a safe backfill and deployment plan exists.
3. Document the column, proto source, nullability, and scope in `docs/schema.md`.
4. Populate it in `src/sink/postgres.ts` only from data actually available through `src/rpc/` or decoded bytes.
5. Expose it in `src/api.ts` if explorer consumers need it, and update `docs/indexer-api.md`.
6. Run `npm run build`; for sink/API changes, run the relevant smoke script and verify duplicate indexing stays idempotent.

## Open questions

1. **Digest byte order for canonical hex.** Proto exposes digest lanes as `fixed64 d0..d3`, but this document's `0x` encoding convention must be verified against the official Rust SDK/CLI display format before freezing URLs and DB unique keys.
2. **Global transaction enumeration.** v0.13.4 public proto lacks a global transaction list or `GetTransactionById`; confirm whether raw `GetBlockByNumber` bytes contain decodable transaction IDs/headers and whether indexing them is stable across v0.13.x.
3. **Complete note discovery.** `SyncNotes` is tag-based and tags are best-effort filters. Define an official strategy for full-public-note coverage (all tags? raw block decode? store internals?) before claiming explorer-wide note completeness.
4. **Private-note consumption payload visibility.** Public docs/protos confirm nullifiers are public and private note details are required by the consumer, but do not clearly state which private-note data, if any, is retained in node/block storage after submitting a proven transaction. Confirm with live v0.13.4 raw block decode before documenting beyond the matrix above.
5. **Finality/L1 settlement.** No separate finalized/LIB field was found in public v0.13.4 RPC. Confirm whether Miden testnet/devnet has any finality or L1 settlement notion that should be exposed later.
6. **Account storage-mode decoding.** Docs state storage mode is encoded in the 3rd/4th most significant bits of account ID; implement and test decoding with official SDK examples before schema constraints or UI labels depend on it.
7. **Public account exhaustive indexing limits.** `GetAccount`, `SyncAccountVault`, and `SyncAccountStorageMaps` have thresholds/pagination and near-tip restrictions; future agents must test live RPC limits and decide backfill policy for large public accounts.

## Pointers

- `docs/api.md` — live-verified public gRPC surface for `miden-node 0.13.4`.
- `docs/schema.md` — Postgres schema rationale and migration policy.
- `docs/indexer-api.md` — read-only HTTP explorer API contract.
- `docs/operations.md` — Docker/runtime operations, deployment, backup, restore, troubleshooting.
- `docs/network-upgrades.md` — procedure for bumping to a new `miden-node` version.
- `docs/future.md` — prioritized future work and acceptance notes.
