# Miden network upgrades

## Purpose

This document describes how to handle a `miden-node` version bump for the Miden indexer branch without mixing assumptions from other network branches.

## Procedure

1. Cut a new branch `miden-indexer-vX.Y.Z` from the current Miden branch.
2. Replace `proto/proto/*` with the new upstream snapshot from `0xPolygonMiden/miden-node` tag `vX.Y.Z`.
3. Run `npm run build`; fix breakages in `src/rpc/`. Update `docs/api.md` with `grpcurl` re-validation against a node running the new version.
4. Sweep `docs/data-model.md` and `docs/schema.md`; add additive `initdb/00N-….sql` migrations for any new fields you decide to index.
5. Re-run the smoke suite in order: RPC → sink → runner → API.
6. Tag and push.

## Compatibility table

| `miden-node` version | Indexer branch | Proto source | Status |
|---|---|---|---|
| `0.13.4` | `miden-indexer-v0.13.4` | `proto/` copied from upstream tag `v0.13.4` | Current supported target |

## Known proto-level gotchas

- `GetAccount` is the public account method; there is no `GetAccountDetails` method in `v0.13.4`.
- Digests are felt 4-tuples `{d0..d3}`, not hex strings, on the public protobuf API.
- `SyncState` v0.13.4 ignores nullifier prefixes; the local client logs and drops requested prefixes because the proto has no field for them.
- `GetBlockByNumber` returns opaque `block` bytes; transaction, note, and nullifier counts must be derived outside the proto surface.
- `GetBlockByNumber.block` can be present but zero-length on v0.13.4. In JavaScript, `Buffer.alloc(0)` is truthy, so `if (!blockResponse.block)` does **not** catch this case.
- `block_hash` is not in the proto; this branch uses `SHA-256(block_bytes)` when bytes are non-empty and a fixed header-derived SHA-256 fallback when block bytes are missing/empty. The exact branch contract is documented in `docs/schema.md` and implemented in `src/sink/postgres.ts`.

## Upgrade notes for future agents

- Do not infer compatibility from generic Miden documentation. Re-check `proto/proto/rpc.proto` and imported type files for every method and field.
- Write endpoints (`SubmitProvenTransaction`, `SubmitProvenBatch`) are not smoke-tested by default because they mutate the network.
- If a new proto exposes decoded block-body fields or global transaction enumeration, update `docs/data-model.md`, `docs/schema.md`, `src/rpc/types.ts`, `src/rpc/client.ts`, sink population, and `docs/indexer-api.md` together.
