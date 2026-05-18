# Future work for the Miden indexer

This roadmap is scoped to things future agents should pick up after the MVP. Items are in priority order.

---

## 0. Protocol limitations — blocked on upstream (v0.13.4)

These fields are **not available** from the current `miden-node 0.13.4` protocol.
Do not attempt to implement them until the relevant upstream type exposes the data.
When a new node version ships, re-check and move the item to the implementation backlog.

### 0.1 `expiration_block_num` on transactions
- **Why missing:** The block body carries `TransactionHeader` (a compact header type),
  which does NOT expose `expiration_block_num()`. That field exists only on
  `ProvenTransaction` / executed transaction types, which are not stored in the block body.
- **When unblocked:** If Miden adds `expiration_block_num` to `TransactionHeader` in the
  block binary format (i.e. `miden-protocol` crate bumps the wire format).
- **Current handling:** Column exists in schema with `DEFAULT NULL`; sidecar always returns
  `None`; API exposes the null value so frontends can show "—".

### 0.2 Account details (nonce, code_commitment, storage_commitment, vault_root)
- **Why missing:** `BlockAccountUpdate` (the per-block account diff in the block body)
  carries only `account_id`, `final_state_hash`, and `is_private`. It does NOT carry
  nonce, code, storage, or vault roots.
- **Partial workaround:** Call `GetAccount` RPC for a specific account. This returns the
  _current_ state only, not historical snapshots. Doing this for every account on every
  block would be extremely expensive. Viable only for a small configured watchlist.
- **When unblocked:** If Miden expands `BlockAccountUpdate` to include full state diff,
  or if a new RPC endpoint returns historical snapshots.
- **Current handling:** Columns `nonce`, `code_commitment`, `storage_commitment`,
  `vault_root` exist in `miden_accounts` schema but remain NULL.

### 0.3 Transaction output_notes_commitment
- **Status:** Implemented in the sidecar for `miden-protocol 0.14.x`.
- **Why possible:** `TransactionHeader` does not expose a dedicated
  `output_notes_commitment()` accessor, but it does expose `output_notes() ->
  &[NoteHeader]`. The commitment can be derived from those note headers using
  the same hash over `(note_id, metadata_commitment)` tuples that the protocol
  uses internally.

### 0.4 Note payload / script
- **Why missing:** The block body contains `OutputNote` metadata (tag, sender, note_id)
  but does NOT contain note script, inputs, or assets. Full note content is only available
  via `GetNotesByIds` RPC for public notes.
- **Partial workaround:** For public notes, call `GetNotesByIds` after indexing. This adds
  significant RPC overhead; use only for a configured tag/note watchlist.
- **When unblocked:** When a future block format includes note payloads or a streaming
  endpoint is added for note content.

### 0.5 Transaction fees / gas
- **Why missing:** Miden v0.13.4 has no on-chain fee market. `verification_base_fee` is
  a block-level field, not a per-transaction field.
- **When unblocked:** When per-transaction fee fields are added to the protocol.

---

## 1. Midenscan parity: public-RPC-backed explorer fields

- **Rationale:** `testnet.midenscan.com` exposes blocks, transactions, accounts,
  created notes, consumed notes/nullifiers, note tags, account updates, account
  code/storage/vault tabs, and overview/network stats. Some of those fields are
  direct public RPC data, while others are backend enrichment (verified names,
  verified Rust/MASM source, registry metadata).
- **Safe public-RPC fields to add first:**
  - block commitment from successor `prev_block_commitment` (available for all
    non-tip rows once the successor is indexed)
  - `chain_length` by requesting MMR proof metadata from
    `GetBlockHeaderByNumber`
  - network-status/API status response from `Status`
  - account-scoped transactions/account updates from `SyncState` and
    `SyncTransactions` for configured accounts
  - tag-scoped created notes from `SyncState`/`SyncNotes` for configured tags
  - consumed nullifiers from `SyncNullifiers` over explicit prefix ranges
  - public account header/code/storage/vault details via `GetAccount`,
    `SyncAccountVault`, and `SyncAccountStorageMaps` for configured public
    accounts
- **Not public-RPC direct:** verified names/components, human Rust source,
  verified note registry, and complete global transaction/note/account
  enumeration without raw block decoding or exhaustive configured scans.
- **Acceptance:** API docs label coverage precisely (`global`, `configured
  accounts`, `configured tags`, `configured prefixes`, or `registry overlay`);
  smoke tests prove restart/idempotency; no endpoint claims Midenscan-level
  completeness unless the source coverage is actually global.

## 2. Real per-block transaction, note, and nullifier population by parsing block bytes

- **Rationale:** `GetBlockByNumber` currently returns opaque raw block bytes, so `tx_count` is a `0/1` fallback from `tx_commitment`, and note/nullifier counts default to `0`.
- **Where to start:** `src/runner/syncRange.ts` (`buildBlockBundle` and `fallbackCounts`), `src/types.d.ts` (`BlockBundle`), `src/sink/postgres.ts`, and `docs/schema.md`.
- **Acceptance:** Raw block bytes from `miden-node 0.13.4` are decoded with a version-matched protocol decoder; block rows contain true counts; duplicate sink runs add no rows; `scripts/smoke-sink.ts` reports idempotency and verified count derivation.

## 3. Wire `SyncState` paging into the runner for richer per-block context

- **Rationale:** `SyncState` can return relevant block headers, account summaries, transaction summaries, note sync records, and MMR deltas for configured accounts/tags, but the runner currently indexes headers plus raw block bytes only.
- **Where to start:** `src/rpc/client.ts` (`syncState` and `syncStatePages`), `src/runner/syncRange.ts`, `src/types.d.ts`, `src/sink/postgres.ts`.
- **Acceptance:** Configured account IDs and note tags feed `SyncState`; returned summaries/notes populate the existing nullable/full-scope tables; pagination reaches `chainTip`; progress remains monotonic with `GREATEST`.

## 4. Account state diff tracking once decoding is settled

- **Rationale:** `miden_accounts` stores the latest known commitment/header fields, but explorer users will eventually need historical vault, storage-map, nonce, and commitment changes for public accounts.
- **Where to start:** `src/rpc/client.ts` (`getAccount`, `syncAccountVault`, `syncAccountStorageMaps`), `initdb/001-schema.sql` deferred account-history comment, future additive migrations, `docs/schema.md`.
- **Acceptance:** Additive history tables capture account commitment and public-account state changes by block; backfill policy for large accounts is documented; API endpoints clearly label coverage.

## 5. Resolve the seven open questions in `docs/data-model.md`

- **Rationale:** Digest byte order, global transaction enumeration, complete note discovery, private-note payload visibility, finality/L1 settlement, account storage-mode decoding, and exhaustive public account indexing all affect stable explorer semantics.
- **Where to start:** `docs/data-model.md` section 7, `proto/`, live `grpcurl` checks, official Rust SDK/CLI examples, and version-matched raw block decoding.
- **Acceptance:** Each question is answered with evidence; affected docs/code/schema are updated; uncertain coverage is removed from public claims or explicitly labeled.

## 6. Maintained counter table for `/api/v1/stats`

- **Rationale:** `/api/v1/stats` currently uses exact `count(*)` queries. That is simple and correct but can become expensive as tables grow.
- **Where to start:** `src/api.ts` stats query, `src/sink/postgres.ts`, and a new additive migration under `initdb/`.
- **Acceptance:** A maintained stats table is updated atomically with sink writes; `/api/v1/stats` no longer scans large tables; smoke/API tests still pass after duplicate indexing.

## 7. Prometheus `/metrics` endpoint

- **Rationale:** Operators need scrapeable lag, block ingestion, RPC error, retry, and API request metrics beyond log lines and `/health`.
- **Where to start:** `src/api.ts`, `src/runner/follow.ts`, `src/runner/syncRange.ts`, `src/rpc/client.ts`, and `docs/operations.md`.
- **Acceptance:** `/metrics` exposes Prometheus text format; counters/gauges cover runner lag, last block, RPC failures, sink batches, and API requests; operations docs include scrape examples.

## 8. Reorg handling

- **Rationale:** Miden v0.13.4 appears centralized and append-only from the public RPC perspective, and the current model assumes blocks returned by the canonical node remain canonical. If reorgs appear later, `miden_blocks` primary keys, child-table cascades, progress, and API semantics would need revision.
- **Where to start:** `docs/data-model.md` finality section, `src/runner/syncRange.ts`, `src/sink/postgres.ts`, `miden_blocks.prev_block_commitment`, and future node/proto finality fields.
- **Acceptance:** The append-only assumption is explicitly revalidated for the target node version; if reorgs are possible, the schema gains canonicality/replaced markers or rollback handling, progress can move safely, and API docs expose finality/canonical labels accurately.

## 9. Multi-RPC failover in `MidenRpcClient`

- **Rationale:** A single `NODE_URL` is an operational single point of failure for both backfill and live follow.
- **Where to start:** `src/config.ts` for endpoint configuration, `src/rpc/client.ts` connection/call routing, `src/runner/follow.ts` retry behavior, and `docs/operations.md`.
- **Acceptance:** Multiple RPC endpoints can be configured; read calls fail over on retryable transport errors; node version/status mismatches are detected; logs identify the active endpoint without leaking secrets.
