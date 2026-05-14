# Miden Indexer Postgres schema

Target: `miden-node v0.13.4` public gRPC API. The schema is defined in `initdb/001-schema.sql` and stores only data visible to a public external indexer: block headers, raw block bytes when fetched, account-scoped transactions, tag-discovered notes, prefix-discovered nullifiers, latest account commitments, and indexer progress.

## Encoding decisions

- **Hashes, roots, commitments, transaction IDs, note IDs, nullifiers:** stored as `BYTEA` in the raw 32-byte digest form as it appears on the protobuf wire (`primitives.Digest { fixed64 d0, d1, d2, d3 }`). No byte reversal is performed by the database layer. Hex/bech32 formatting for the explorer API belongs in `src/api.ts`.
- **Account IDs:** stored as `BYTEA` using the 15-byte protobuf `account.AccountId.id` representation.
- **Timestamps:** `miden_blocks.timestamp` is `TIMESTAMPTZ` derived from `blockchain.BlockHeader.timestamp`, a `fixed32`/u32 Unix timestamp in seconds, typically with `to_timestamp(header.timestamp)`.
- **Raw block payloads:** `GetBlockByNumber` returns `blockchain.MaybeBlock.block` as opaque `winter_utils::Serializable` bytes, so the schema stores `raw_block_bytes BYTEA` rather than pretending decoded JSON exists.
- **Counts:** block `tx_count`, `note_count`, and `nullifier_count` are indexer-derived coverage counters, not block-header fields.

## `miden_indexer_progress`

Purpose: singleton resume cursor for the MVP indexer. It tracks the last block header durably indexed. Future migrations can add per-stream coverage cursors for notes, nullifiers, accounts, or transactions.

| name | type | nullable | meaning | proto source | scope |
|---|---|---:|---|---|---|
| `id` | `INT` | no | Singleton key, constrained to `1`. | Not proto; database singleton key. | MVP |
| `last_block` | `BIGINT` | no | Last indexed block number; `-1` means none. | `blockchain.BlockHeader.block_num` / `blockchain.BlockNumber.block_num` | MVP |
| `updated_at` | `TIMESTAMPTZ` | no | Database update time. | Not proto. | MVP |

## `miden_blocks`

Purpose: one row per canonical block header. MVP stores structured `BlockHeader` fields and ingestion metadata; Full scope may attach raw block bytes and MMR chain length.

| name | type | nullable | meaning | proto source | scope |
|---|---|---:|---|---|---|
| `block_num` | `BIGINT` | no | Sequential block number. | `blockchain.BlockHeader.block_num` (`fixed32`) | MVP |
| `block_hash` | `BYTEA` | no | Derived explorer block identifier. | Not a direct v0.13.4 field; computed by indexer as `SHA-256(raw block bytes)` when `GetBlockByNumber.block` is non-empty, otherwise `SHA-256` over a fixed fallback encoding of structured header fields (see derivation note below). | MVP |
| `prev_block_commitment` | `BYTEA` | no | Commitment of the previous block header. | `blockchain.BlockHeader.prev_block_commitment` | MVP |
| `chain_commitment` | `BYTEA` | no | MMR commitment for the chain. | `blockchain.BlockHeader.chain_commitment` | MVP |
| `account_root` | `BYTEA` | no | Account database root. | `blockchain.BlockHeader.account_root` | MVP |
| `nullifier_root` | `BYTEA` | no | Nullifier database root. | `blockchain.BlockHeader.nullifier_root` | MVP |
| `note_root` | `BYTEA` | no | Commitment to notes created in the block. | `blockchain.BlockHeader.note_root` | MVP |
| `tx_commitment` | `BYTEA` | no | Commitment to IDs of transactions affecting accounts in the block. | `blockchain.BlockHeader.tx_commitment` | MVP |
| `validator_key` | `BYTEA` | no | Validator ECDSA public key bytes. | `blockchain.BlockHeader.validator_key.validator_key` | MVP |
| `tx_kernel_commitment` | `BYTEA` | no | Commitment to transaction kernels supported by the block. | `blockchain.BlockHeader.tx_kernel_commitment` | MVP |
| `native_asset_id` | `BYTEA` | no | Native fee asset faucet account ID. | `blockchain.BlockHeader.fee_parameters.native_asset_id.id` | MVP |
| `verification_base_fee` | `BIGINT` | no | Base verification fee, widened from fixed32. | `blockchain.BlockHeader.fee_parameters.verification_base_fee` | MVP |
| `timestamp` | `TIMESTAMPTZ` | no | Block creation time. | `blockchain.BlockHeader.timestamp` converted from Unix seconds. | MVP |
| `tx_count` | `INT` | no | Observed transaction count for this block. | Indexer-derived. | MVP |
| `note_count` | `INT` | no | Observed note count for this block. | Indexer-derived. | MVP |
| `nullifier_count` | `INT` | no | Observed nullifier count for this block. | Indexer-derived. | MVP |
| `version` | `INT` | yes | Protocol version. | `blockchain.BlockHeader.version` | Full |
| `raw_block_bytes` | `BYTEA` | yes | Optional raw serialized block bytes. | `blockchain.MaybeBlock.block`; zero-length payloads are normalized to `NULL` by the sink because they are not useful archival bytes. | Full |
| `chain_length` | `BIGINT` | yes | Optional MMR chain length returned with header proof requests. | `rpc.BlockHeaderByNumberResponse.chain_length` | Full |
| `inserted_at` | `TIMESTAMPTZ` | no | Database ingestion time. | Not proto. | MVP |

Indexes: `idx_miden_blocks_timestamp (timestamp DESC)`, `idx_miden_blocks_block_hash (block_hash)`.

## `miden_transactions`

Purpose: one row per discovered transaction. In v0.13.4, transaction coverage is account-scoped unless raw block decoding is added; there is no global transaction list or `GetTransactionById` RPC.

| name | type | nullable | meaning | proto source | scope |
|---|---|---:|---|---|---|
| `tx_id` | `BYTEA` | no | Transaction ID. | `transaction.TransactionSummary.transaction_id.id` | MVP |
| `block_num` | `BIGINT` | no | Block containing the transaction. | `transaction.TransactionSummary.block_num` or `rpc.TransactionRecord.block_num` | MVP |
| `account_id` | `BYTEA` | no | Account affected by the transaction. | `transaction.TransactionSummary.account_id.id` / `TransactionHeader.account_id.id` | MVP |
| `init_account_state` | `BYTEA` | yes | Account state before execution. | `transaction.TransactionHeader.initial_state_commitment` | Full |
| `final_account_state` | `BYTEA` | yes | Account state after execution. | `transaction.TransactionHeader.final_state_commitment` | Full |
| `input_notes_commitment` | `BYTEA` | yes | Reserved decoded protocol commitment. | Not exposed directly; v0.13.4 exposes `TransactionHeader.nullifiers`. | Full |
| `output_notes_commitment` | `BYTEA` | yes | Reserved decoded protocol commitment. | Not exposed directly; v0.13.4 exposes `TransactionHeader.output_notes`. | Full |
| `expiration_block_num` | `BIGINT` | yes | Reserved decoded transaction expiration. | Not exposed by public v0.13.4 transaction summary/header protos. | Full |
| `input_nullifiers` | `BYTEA[]` | yes | Denormalized input nullifier digests. | `transaction.TransactionHeader.nullifiers[]` | Full |
| `output_note_ids` | `BYTEA[]` | yes | Denormalized output note IDs. | `transaction.TransactionHeader.output_notes[].note_id.id` | Full |
| `inserted_at` | `TIMESTAMPTZ` | no | Database ingestion time. | Not proto. | MVP |

Indexes: `idx_miden_transactions_block_num (block_num)`, `idx_miden_transactions_account_id (account_id)`.

## `miden_notes`

Purpose: one row per discovered note. MVP notes generally come from `SyncNotes`, `SyncState`, or `GetNotesById`; coverage depends on configured note tags or future raw block decoding.

| name | type | nullable | meaning | proto source | scope |
|---|---|---:|---|---|---|
| `note_id` | `BYTEA` | no | Note commitment/ID. | `note.NoteId.id` / `NoteSyncRecord.note_id.id` | MVP |
| `block_num` | `BIGINT` | no | Block where the note was created. | `NoteInclusionInBlockProof.block_num` or containing block header for sync records. | MVP |
| `note_index` | `INT` | no | Note index within the block. | `note.NoteSyncRecord.note_index_in_block` / `NoteInclusionInBlockProof.note_index_in_block` | MVP |
| `is_public` | `BOOLEAN` | no | Derived visibility flag. | Derived from `NoteMetadata.note_type` and details presence. | MVP |
| `metadata` | `BYTEA` | no | Serialized/raw metadata payload as stored by indexer. | Structured `note.NoteMetadata`; not a bytes field. | MVP |
| `sender` | `BYTEA` | yes | Sender account ID. | `note.NoteMetadata.sender.id` | Full |
| `tag` | `BIGINT` | yes | Note discovery tag. | `note.NoteMetadata.tag` | Full |
| `note_type` | `SMALLINT` | yes | Numeric note type (`1` public, `2` private, `3` encrypted). | `note.NoteMetadata.note_type` | Full |
| `attachment` | `BYTEA` | yes | Serialized note attachment. | `note.NoteMetadata.attachment` | Full |
| `aux` | `BIGINT` | yes | Reserved decoded attachment/metadata component. | Not a top-level v0.13.4 proto field. | Full |
| `execution_hint` | `BIGINT` | yes | Reserved decoded attachment/metadata component. | Not a top-level v0.13.4 proto field. | Full |
| `recipient_digest` | `BYTEA` | yes | Decoded public-note recipient digest. | From `note.Note.details`/`NetworkNote.details`, not top-level proto. | Full |
| `assets` | `BYTEA` | yes | Serialized/decoded public-note asset data. | From `note.Note.details`/`NetworkNote.details`; private assets are not observable. | Full |
| `script_root` | `BYTEA` | yes | Decoded public-note script root. | From note details or script lookup workflows, not `NoteSyncRecord`. | Full |
| `inputs_hash` | `BYTEA` | yes | Decoded public-note storage/input commitment. | From note details, not top-level proto. | Full |
| `serial_num` | `BYTEA` | yes | Decoded public-note serial number. | From note details; private serial numbers are not observable. | Full |
| `note_details` | `BYTEA` | yes | Raw note details bytes when public/network details are available. | `note.Note.details` / `note.NetworkNote.details` | Full |
| `inserted_at` | `TIMESTAMPTZ` | no | Database ingestion time. | Not proto. | MVP |

Indexes: `idx_miden_notes_block_num (block_num)`, partial indexes on `sender`, `tag`, and `script_root` when not null.

## `miden_nullifiers`

Purpose: one row per consumed nullifier observed from `SyncNullifiers`. Complete coverage requires scanning configured 16-bit prefixes.

| name | type | nullable | meaning | proto source | scope |
|---|---|---:|---|---|---|
| `nullifier` | `BYTEA` | no | Consumed nullifier digest. | `rpc.SyncNullifiersResponse.NullifierUpdate.nullifier` | MVP |
| `block_num` | `BIGINT` | no | Block where the nullifier was recorded consumed. | `rpc.SyncNullifiersResponse.NullifierUpdate.block_num` | MVP |
| `consumed_note_id` | `BYTEA` | yes | Optional resolved public-note ID. | Not exposed by `SyncNullifiers`; indexer-derived. | Full |
| `inserted_at` | `TIMESTAMPTZ` | no | Database ingestion time. | Not proto. | MVP |

Index: `idx_miden_nullifiers_block_num (block_num)`.

## `miden_accounts`

Purpose: latest known commitment per account ID. MVP rows come from `AccountSummary`/`AccountWitness`; public header fields are populated only when `GetAccount(details=...)` returns details.

| name | type | nullable | meaning | proto source | scope |
|---|---|---:|---|---|---|
| `account_id` | `BYTEA` | no | Account ID. | `account.AccountId.id` | MVP |
| `is_public` | `BOOLEAN` | no | Derived visibility flag. | Derived from returned details or decoded account ID storage mode; not standalone proto. | MVP |
| `last_block_num` | `BIGINT` | no | Block where latest commitment/details were observed. | `account.AccountSummary.block_num` / `rpc.AccountResponse.block_num.block_num` | MVP |
| `account_commitment` | `BYTEA` | no | Latest account state commitment. | `account.AccountSummary.account_commitment` / `account.AccountWitness.commitment` | MVP |
| `nonce` | `BIGINT` | yes | Public account nonce. | `account.AccountHeader.nonce` | Full |
| `code_commitment` | `BYTEA` | yes | Public account code commitment. | `account.AccountHeader.code_commitment` | Full |
| `storage_commitment` | `BYTEA` | yes | Public account storage commitment. | `account.AccountHeader.storage_commitment` | Full |
| `vault_root` | `BYTEA` | yes | Public account vault root. | `account.AccountHeader.vault_root` | Full |
| `account_type` | `SMALLINT` | yes | Reserved protocol account-type bits. | Account ID bit decoding; not standalone proto. | Full |
| `storage_mode` | `SMALLINT` | yes | Reserved protocol storage-mode bits. | Account ID bit decoding; not standalone proto. | Full |
| `updated_at` | `TIMESTAMPTZ` | no | Database update time. | Not proto. | MVP |

Index: `idx_miden_accounts_last_block_num (last_block_num)`.

## Deferred `miden_account_state_history`

`001-schema.sql` includes a commented-out table for append-only `(account_id, block_num, account_commitment)` history. It is deferred because the MVP sink needs latest account state and because v0.13.4 `SyncState` returns latest account commitments for requested accounts rather than a complete global account-change stream. Add it in a later migration when account-history coverage semantics are finalized.

## Sink insert/upsert pattern

Foreign keys are designed for the obvious block-first sink order:

```sql
BEGIN;
INSERT INTO miden_blocks (
  block_num, block_hash, prev_block_commitment, chain_commitment, account_root,
  nullifier_root, note_root, tx_commitment, validator_key, tx_kernel_commitment,
  native_asset_id, timestamp
) VALUES (
  1, decode(repeat('01', 32), 'hex'), decode(repeat('02', 32), 'hex'),
  decode(repeat('03', 32), 'hex'), decode(repeat('04', 32), 'hex'),
  decode(repeat('05', 32), 'hex'), decode(repeat('06', 32), 'hex'),
  decode(repeat('07', 32), 'hex'), decode(repeat('08', 33), 'hex'),
  decode(repeat('09', 32), 'hex'), decode(repeat('0a', 15), 'hex'),
  to_timestamp(1771280734)
) ON CONFLICT (block_num) DO UPDATE SET timestamp = EXCLUDED.timestamp;

INSERT INTO miden_transactions (tx_id, block_num, account_id)
VALUES (decode(repeat('11', 32), 'hex'), 1, decode(repeat('12', 15), 'hex'))
ON CONFLICT (tx_id) DO UPDATE SET block_num = EXCLUDED.block_num, account_id = EXCLUDED.account_id;

INSERT INTO miden_notes (note_id, block_num, note_index, is_public, metadata)
VALUES (decode(repeat('21', 32), 'hex'), 1, 0, true, '\x')
ON CONFLICT (note_id) DO UPDATE SET block_num = EXCLUDED.block_num, note_index = EXCLUDED.note_index;

INSERT INTO miden_nullifiers (nullifier, block_num)
VALUES (decode(repeat('31', 32), 'hex'), 1)
ON CONFLICT (nullifier) DO UPDATE SET block_num = EXCLUDED.block_num;

INSERT INTO miden_accounts (account_id, is_public, last_block_num, account_commitment)
VALUES (decode(repeat('41', 15), 'hex'), true, 1, decode(repeat('42', 32), 'hex'))
ON CONFLICT (account_id) DO UPDATE SET
  is_public = EXCLUDED.is_public,
  last_block_num = EXCLUDED.last_block_num,
  account_commitment = EXCLUDED.account_commitment,
  updated_at = now();
COMMIT;
```

The child tables use `ON DELETE CASCADE` for block-scoped transactions, notes, and nullifiers. `miden_accounts.last_block_num` uses `ON DELETE RESTRICT` because the latest account state should not outlive the block from which it was observed.

## Migration policy

Schema files are versioned by filename: `001-schema.sql`, then future changes as `002-...sql`, `003-...sql`, and so on. After `001-schema.sql` is deployed, future changes should be additive migrations in new files rather than edits to `001`, except when rebuilding a throwaway development database before release.

## `block_hash` derivation

`miden-node v0.13.4` does not expose a current-block hash field in `BlockHeader`. The sink therefore derives the explorer-facing `miden_blocks.block_hash` with a two-path rule:

1. **Non-empty raw bytes:** when `GetBlockByNumber.block` is present and `octet_length(raw_block_bytes) > 0`, `block_hash = SHA-256(raw_block_bytes)`.
2. **Missing or zero-length raw bytes:** when the node returns no bytes or an empty `bytes` payload, `block_hash = SHA-256(fallback_encoding)` where `fallback_encoding` is the exact concatenation below:

   - UTF-8 domain separator: `miden-block-hash-fallback-v1\0`
   - `version` as big-endian `uint32`
   - `block_num` as big-endian `uint32`
   - `prev_block_commitment` raw 32 bytes
   - `chain_commitment` raw 32 bytes
   - `account_root` raw 32 bytes
   - `nullifier_root` raw 32 bytes
   - `note_root` raw 32 bytes
   - `tx_commitment` raw 32 bytes
   - `tx_kernel_commitment` raw 32 bytes
   - `validator_key.validator_key` as `uint32 byte_length || bytes`
   - `fee_parameters.native_asset_id.id` as `uint32 byte_length || bytes`
   - `fee_parameters.verification_base_fee` as big-endian `uint32`
   - `timestamp` as big-endian `uint32`

This fallback is branch-local and deterministic. It intentionally includes `block_num`, which is unique by protocol invariant, so different blocks cannot collide just because the node returned empty block bytes.

### Caveats

- `block_hash` is an **explorer identifier**, not the native Miden protocol `BlockHeader.commitment()` / RPX hash.
- The two derivation paths are semantically different: non-empty rows hash the raw serialized block, fallback rows hash only structured header fields.
- `GetBlockByNumber.block` can be present but zero-length on v0.13.4. In JavaScript, `Buffer.alloc(0)` is truthy, so callers must check `.length > 0`, not just truthiness.
- `raw_block_bytes` is normalized to `NULL` when the node returns no payload or a zero-length payload.
