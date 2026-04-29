# Miden node 0.13.4 public RPC surface

## 1. Overview

Live verification target: `miden-node 0.13.4` bundled mode, plaintext gRPC at `127.0.0.1:57291` / `0.0.0.0:57291`.

Source of truth:

- Upstream repository: `0xPolygonMiden/miden-node`
- Tag: `v0.13.4`
- Commit: `e8616006abc7689c686c8af0a3e2e46ed64cf1ef`
- Local proto files copied verbatim under `proto/proto/`:
  - `rpc.proto`
  - `types/account.proto`
  - `types/blockchain.proto`
  - `types/note.proto`
  - `types/primitives.proto`
  - `types/transaction.proto`

Public service exposed by the bundled node:

```proto
package rpc;
service Api { ... }
```

Use grpcurl with local protos because reflection is not required:

```bash
grpcurl -plaintext \
  -import-path /pool0/miden-indexer/proto/proto \
  -proto rpc.proto \
  -d '{}' \
  127.0.0.1:57291 rpc.Api/Status
```

The live node responded with `version: "0.13.4"`; store and block-producer were both `connected`.

## 2. Method-by-method table

| Method | Request type | Response type | Semantics | Indexer notes |
|---|---|---|---|---|
| `Status` | `google.protobuf.Empty` | `rpc.RpcStatus` | Node, store, and block-producer health/version plus genesis commitment. | Use for health checks and confirming version. Live verified. |
| `CheckNullifiers` | `rpc.NullifierList` | `rpc.CheckNullifiersResponse` | Returns SMT opening proof for each requested nullifier. | Use to check note consumption by nullifier digest. Limit: `nullifier <= 1000`. Live verified. |
| `GetAccount` | `rpc.AccountRequest` | `rpc.AccountResponse` | Returns account witness and optional details for a public account. | This is the proto method; there is no `GetAccountDetails` method. Use as `GetAccount`. Limit: `storage_map_key <= 64`. Live verified with a zero/non-existing account ID. |
| `GetBlockByNumber` | `blockchain.BlockNumber` | `blockchain.MaybeBlock` | Returns raw serialized block bytes for a block number. | Use for raw block archival/decoding. Live verified. |
| `GetBlockHeaderByNumber` | `rpc.BlockHeaderByNumberRequest` | `rpc.BlockHeaderByNumberResponse` | Returns a block header, optionally with MMR proof and chain length. | Use for indexed block headers and chain authentication. Live verified. |
| `GetNotesById` | `note.NoteIdList` | `note.CommittedNoteList` | Returns committed notes for requested note IDs. | Use for explicit note lookup. Limit: `note_id <= 100`. Live verified; zero digest returned no notes. |
| `GetNoteScriptByRoot` | `note.NoteRoot` | `rpc.MaybeNoteScript` | Returns note script for a note root if known. | Not needed for first indexer pass. Live verified with zero root returning empty. |
| `SubmitProvenTransaction` | `transaction.ProvenTransaction` | `blockchain.BlockNumber` | Write endpoint: submits a proven transaction. | Public but **not used** by indexer; not invoked to avoid side effects. |
| `SubmitProvenBatch` | `transaction.ProvenTransactionBatch` | `blockchain.BlockNumber` | Write endpoint: submits a proven transaction batch. | Public but **not used** by indexer; not invoked to avoid side effects. |
| `SyncNullifiers` | `rpc.SyncNullifiersRequest` | `rpc.SyncNullifiersResponse` | Returns nullifiers matching 16-bit prefixes in a block range. | Useful if indexing consumed notes by prefix. Limit: `nullifier <= 1000`; `prefix_len` currently only `16`. Live verified. |
| `SyncAccountVault` | `rpc.SyncAccountVaultRequest` | `rpc.SyncAccountVaultResponse` | Returns vault asset updates for a public account over a block range. | Not first-pass required unless account vault indexing is needed. Live verified. |
| `SyncNotes` | `rpc.SyncNotesRequest` | `rpc.SyncNotesResponse` | Returns next block in range containing requested note tags, or chain tip. | Alternative to `SyncState` for notes-only sync. Limit: `note_tag <= 1000`. Live verified. |
| `SyncState` | `rpc.SyncStateRequest` | `rpc.SyncStateResponse` | Returns chain tip, next relevant block header, MMR delta, account summaries, transaction summaries, and note sync records. | Primary polling endpoint. Limits: `account_id <= 1000`, `note_tag <= 1000`. Live verified. |
| `SyncAccountStorageMaps` | `rpc.SyncAccountStorageMapsRequest` | `rpc.SyncAccountStorageMapsResponse` | Returns storage map updates for a public account over a block range. | Not first-pass required unless public storage maps are indexed. Live verified. |
| `SyncTransactions` | `rpc.SyncTransactionsRequest` | `rpc.SyncTransactionsResponse` | Returns transaction records for requested accounts over a block range. | Useful for account-scoped tx indexing. Live verified. |
| `GetLimits` | `google.protobuf.Empty` | `rpc.RpcLimits` | Returns configured RPC query parameter limits. | Call at startup to avoid oversized requests. Live verified. |

No public RPC method named `GetAccountDetails` exists in `v0.13.4`; use `GetAccount`.
No public RPC method named `GetBlockHeaders`, `GetTransactions`, or `GetNotes` exists; use the sync/look-up endpoints above.
The `internal/*` and `remote_prover.proto` protos are not imported by `rpc.proto` and are not part of the public RPC surface used here.

## 3. Indexer-planned methods: fields and verified grpcurl examples

### Shared message types used below

```proto
primitives.Digest {
  fixed64 d0 = 1;
  fixed64 d1 = 2;
  fixed64 d2 = 3;
  fixed64 d3 = 4;
}

account.AccountId {
  bytes id = 1; // 15-byte AccountId, base64 in grpcurl JSON
}

blockchain.BlockNumber {
  fixed32 block_num = 1; // JSON: blockNum
}

blockchain.BlockHeader {
  uint32 version = 1;
  primitives.Digest prev_block_commitment = 2;
  fixed32 block_num = 3;
  primitives.Digest chain_commitment = 4;
  primitives.Digest account_root = 5;
  primitives.Digest nullifier_root = 6;
  primitives.Digest note_root = 7;
  primitives.Digest tx_commitment = 8;
  blockchain.ValidatorPublicKey validator_key = 9;
  primitives.Digest tx_kernel_commitment = 10;
  blockchain.FeeParameters fee_parameters = 11;
  fixed32 timestamp = 12;
}

blockchain.ValidatorPublicKey { bytes validator_key = 1; }
blockchain.FeeParameters {
  account.AccountId native_asset_id = 1;
  fixed32 verification_base_fee = 2;
}

primitives.MerklePath { repeated primitives.Digest siblings = 1; }
primitives.MmrDelta {
  uint64 forest = 1;
  repeated primitives.Digest data = 2;
}

primitives.SparseMerklePath {
  fixed64 empty_nodes_mask = 1;
  repeated primitives.Digest siblings = 2;
}
primitives.SmtOpening {
  primitives.SparseMerklePath path = 1;
  primitives.SmtLeaf leaf = 2;
}
primitives.SmtLeaf oneof leaf {
  uint64 empty_leaf_index = 1;
  primitives.SmtLeafEntry single = 2;
  primitives.SmtLeafEntryList multiple = 3;
}
primitives.SmtLeafEntry { primitives.Digest key = 1; primitives.Digest value = 2; }
primitives.SmtLeafEntryList { repeated primitives.SmtLeafEntry entries = 1; }
```

### `GetBlockHeaderByNumber`

Fields:

```proto
rpc.BlockHeaderByNumberRequest {
  optional uint32 block_num = 1;          // omitted => latest; JSON: blockNum
  optional bool include_mmr_proof = 2;    // JSON: includeMmrProof
}
rpc.BlockHeaderByNumberResponse {
  blockchain.BlockHeader block_header = 1;
  optional primitives.MerklePath mmr_path = 2;
  optional fixed32 chain_length = 3;
}
```

Verified command:

```bash
grpcurl -plaintext -import-path /pool0/miden-indexer/proto/proto -proto rpc.proto \
  -d '{"blockNum":1,"includeMmrProof":true}' \
  127.0.0.1:57291 rpc.Api/GetBlockHeaderByNumber
```

Captured response, with `mmrPath.siblings` trimmed:

```json
{
  "blockHeader": {
    "prevBlockCommitment": { "d0": "3927611849750685065", "d1": "12513777742572208837", "d2": "15527706889649545347", "d3": "10189565380207197507" },
    "blockNum": 1,
    "chainCommitment": { "d0": "17817796759686571656", "d1": "11329897871850457441", "d2": "14266501892439801881", "d3": "2058465781284682041" },
    "accountRoot": { "d0": "17347058876515973071", "d1": "6140349279720812181", "d2": "17557560973219944318", "d3": "9904295910365002073" },
    "nullifierRoot": { "d0": "15321474589252129342", "d1": "17373224439259377994", "d2": "15071539326562317628", "d3": "3312677166725950353" },
    "noteRoot": { "d0": "10650694022550988030", "d1": "5634734408638476525", "d2": "9233115969432897632", "d3": "1437907447409278328" },
    "txCommitment": {},
    "validatorKey": { "validatorKey": "AxuExVZ7EmRAmV0+1aq6BWXXHhg0YEgZ/5wX9enV3QeP" },
    "txKernelCommitment": { "d0": "2639969106115683546", "d1": "3735174965860492282", "d2": "18250622132741852465", "d3": "13164916897757009368" },
    "feeParameters": { "nativeAssetId": { "id": "os8TaylbxSBcHBIt+WMb" } },
    "timestamp": 1771280734
  },
  "mmrPath": {
    "siblings": [
      { "d0": "3927611849750685065", "d1": "12513777742572208837", "d2": "15527706889649545347", "d3": "10189565380207197507" },
      { "d0": "18339347275588911945", "d1": "17680761807232689088", "d2": "9022654797880202983", "d3": "458286768269165109" }
    ]
  },
  "chainLength": 2055531
}
```

Notes:

- `version` and `verificationBaseFee` are omitted by grpcurl when zero.
- `timestamp` is a `fixed32` Unix timestamp value from the proto, not an RFC3339 string.

### `GetBlockByNumber`

Fields:

```proto
blockchain.BlockNumber { fixed32 block_num = 1; }
blockchain.MaybeBlock { optional bytes block = 1; }
```

Verified command:

```bash
grpcurl -plaintext -import-path /pool0/miden-indexer/proto/proto -proto rpc.proto \
  -d '{"blockNum":1}' \
  127.0.0.1:57291 rpc.Api/GetBlockByNumber
```

Captured response, block bytes shortened:

```json
{
  "block": "AAAAAIklAQArroE2xcI0WI7eqa2DYPKVJX9910M93ga6m2iNAQAAAIhmOQ3Ah0X3YckZCRbiO50ZAFBO4sv8xTk5xcu4I5Ecz3eFuCMivfCVrpUOI+c2VX5XCWOu/KjzWfmov6cgc4k+EoxX9s+g1EqxMImUFxrxPLUTQirdKNGRaz/yVP74Lf4kh6HI3c6T7TCRLheZMk5gyAgYDp4igHj9t340efQTAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADa5Ac06g2jJPrjC3bXAdYzMc31PyI8R/3YFVj0Ki6ztgMbhMVWexJkQJldPtWqugVl1x4YNGBIGf+cF/Xp1d0Hj6LPE2spW8UgXBwSLfljGwAAAABemZNpAQEBASU8eXdE3kUE3fzlQ+5ZmpmH+KaEUscgxmaSng/m9F66JQCgfbgYA7rxWdEWvPJ9VGNJVcPY3UopQ2yyOrXM8PwB"
}
```

Notes:

- `block` is a protobuf `bytes` field; grpcurl JSON renders it as base64.
- The payload is Miden's `winter_utils::Serializable` encoding for `miden_protocol::block::Block`; the proto does not expose decoded transaction/note fields here.

### `SyncState`

Fields:

```proto
rpc.SyncStateRequest {
  fixed32 block_num = 1;                    // last known block; response starts after it
  repeated account.AccountId account_ids = 2;
  repeated fixed32 note_tags = 3;
}
rpc.SyncStateResponse {
  fixed32 chain_tip = 1;
  blockchain.BlockHeader block_header = 2;
  primitives.MmrDelta mmr_delta = 3;
  repeated account.AccountSummary accounts = 5;
  repeated transaction.TransactionSummary transactions = 6;
  repeated note.NoteSyncRecord notes = 7;
}
account.AccountSummary {
  account.AccountId account_id = 1;
  primitives.Digest account_commitment = 2;
  uint32 block_num = 3;
}
transaction.TransactionSummary {
  transaction.TransactionId transaction_id = 1;
  fixed32 block_num = 2;
  account.AccountId account_id = 3;
}
transaction.TransactionId { primitives.Digest id = 1; }
note.NoteSyncRecord {
  note.NoteId note_id = 1;
  uint32 note_index_in_block = 2;
  note.NoteMetadata metadata = 3;
  primitives.SparseMerklePath inclusion_path = 4;
}
note.NoteId { primitives.Digest id = 1; }
note.NoteMetadata {
  account.AccountId sender = 1;
  uint32 note_type = 2;
  fixed32 tag = 3;
  bytes attachment = 4;
}
```

Verified command:

```bash
grpcurl -plaintext -import-path /pool0/miden-indexer/proto/proto -proto rpc.proto \
  -d '{"blockNum":2055519,"accountIds":[],"noteTags":[]}' \
  127.0.0.1:57291 rpc.Api/SyncState
```

Captured response:

```json
{
  "chainTip": 2055530,
  "blockHeader": {
    "prevBlockCommitment": { "d0": "8044144175949162627", "d1": "12327574919986903376", "d2": "1261105295437903211", "d3": "1454727115389066193" },
    "blockNum": 2055530,
    "chainCommitment": { "d0": "1032765441094431732", "d1": "12096374391196442817", "d2": "15816064235967354822", "d3": "7274821581593058960" },
    "accountRoot": { "d0": "17347058876515973071", "d1": "6140349279720812181", "d2": "17557560973219944318", "d3": "9904295910365002073" },
    "nullifierRoot": { "d0": "15321474589252129342", "d1": "17373224439259377994", "d2": "15071539326562317628", "d3": "3312677166725950353" },
    "noteRoot": { "d0": "10650694022550988030", "d1": "5634734408638476525", "d2": "9233115969432897632", "d3": "1437907447409278328" },
    "txCommitment": {},
    "validatorKey": { "validatorKey": "AxuExVZ7EmRAmV0+1aq6BWXXHhg0YEgZ/5wX9enV3QeP" },
    "txKernelCommitment": { "d0": "2639969106115683546", "d1": "3735174965860492282", "d2": "18250622132741852465", "d3": "13164916897757009368" },
    "feeParameters": { "nativeAssetId": { "id": "os8TaylbxSBcHBIt+WMb" } },
    "timestamp": 1777458132
  },
  "mmrDelta": {
    "forest": "2055530",
    "data": [
      { "d0": "6528093692157024986", "d1": "17773289523220778726", "d2": "5172048597795921496", "d3": "18280552828634637622" },
      { "d0": "12735032987636584037", "d1": "12396693289810235107", "d2": "17037274800567444596", "d3": "9521140746492472525" }
    ]
  }
}
```

Notes:

- Empty repeated fields are omitted in grpcurl JSON. In this capture, `accounts`, `transactions`, and `notes` were empty.
- `blockNum` in the request is the last known block, not the first block to fetch. The server returns data after it, up to the next matching note block or chain tip.

### `GetAccount` (replacement for expected `GetAccountDetails`)

Fields:

```proto
rpc.AccountRequest {
  account.AccountId account_id = 1;
  optional blockchain.BlockNumber block_num = 2; // defaults to current chain tip
  optional AccountDetailRequest details = 3;
}
rpc.AccountRequest.AccountDetailRequest {
  optional primitives.Digest code_commitment = 1;
  optional primitives.Digest asset_vault_commitment = 2;
  repeated StorageMapDetailRequest storage_maps = 3;
}
rpc.AccountRequest.AccountDetailRequest.StorageMapDetailRequest {
  string slot_name = 1;
  oneof slot_data {
    bool all_entries = 2;
    MapKeys map_keys = 3;
  }
}
rpc.AccountRequest.AccountDetailRequest.StorageMapDetailRequest.MapKeys {
  repeated primitives.Digest map_keys = 1;
}
rpc.AccountResponse {
  blockchain.BlockNumber block_num = 1;
  account.AccountWitness witness = 2;
  optional AccountDetails details = 3;
}
account.AccountWitness {
  account.AccountId account_id = 1;
  account.AccountId witness_id = 2;
  primitives.Digest commitment = 3;
  primitives.SparseMerklePath path = 4;
}
rpc.AccountResponse.AccountDetails {
  account.AccountHeader header = 1;
  rpc.AccountStorageDetails storage_details = 2;
  optional bytes code = 3;
  optional rpc.AccountVaultDetails vault_details = 4;
}
account.AccountHeader {
  account.AccountId account_id = 1;
  primitives.Digest vault_root = 2;
  primitives.Digest storage_commitment = 3;
  primitives.Digest code_commitment = 4;
  uint64 nonce = 5;
}
rpc.AccountStorageDetails {
  account.AccountStorageHeader header = 1;
  repeated AccountStorageMapDetails map_details = 2;
}
rpc.AccountStorageDetails.AccountStorageMapDetails {
  string slot_name = 1;
  bool too_many_entries = 2;
  oneof entries {
    AllMapEntries all_entries = 3;
    MapEntriesWithProofs entries_with_proofs = 4;
  }
}
rpc.AccountStorageDetails.AccountStorageMapDetails.AllMapEntries {
  repeated StorageMapEntry entries = 1;
}
rpc.AccountStorageDetails.AccountStorageMapDetails.AllMapEntries.StorageMapEntry {
  primitives.Digest key = 1;
  primitives.Digest value = 2;
}
rpc.AccountStorageDetails.AccountStorageMapDetails.MapEntriesWithProofs {
  repeated StorageMapEntryWithProof entries = 1;
}
rpc.AccountStorageDetails.AccountStorageMapDetails.MapEntriesWithProofs.StorageMapEntryWithProof {
  primitives.Digest key = 1;
  primitives.Digest value = 2;
  primitives.SmtOpening proof = 3;
}
account.AccountStorageHeader { repeated StorageSlot slots = 1; }
account.AccountStorageHeader.StorageSlot {
  string slot_name = 1;
  uint32 slot_type = 2;
  primitives.Digest commitment = 3;
}
rpc.AccountVaultDetails {
  bool too_many_assets = 1;
  repeated primitives.Asset assets = 2;
}
primitives.Asset { primitives.Digest asset = 1; }
```

Verified command:

```bash
grpcurl -plaintext -import-path /pool0/miden-indexer/proto/proto -proto rpc.proto \
  -d '{"accountId":{"id":"AAAAAAAAAAAAAAAAAAAA"}}' \
  127.0.0.1:57291 rpc.Api/GetAccount
```

Captured response for a zero/non-existing account ID:

```json
{
  "blockNum": { "blockNum": 2055530 },
  "witness": {
    "accountId": { "id": "AAAAAAAAAAAAAAAAAAAA" },
    "witnessId": { "id": "AAAAAAAAAAAAAAAAAAAA" },
    "commitment": {},
    "path": {
      "emptyNodesMask": "18446744073709551614",
      "siblings": [
        { "d0": "2851736488267898304", "d1": "9617734773601865385", "d2": "240857762235637817", "d3": "17457948818130323735" }
      ]
    }
  }
}
```

Notes:

- Account IDs are `bytes`; grpcurl JSON expects base64. `AAAAAAAAAAAAAAAAAAAA` is 15 zero bytes.
- `details` is optional and only relevant for public accounts; no public account details were returned for the zero account.

### `CheckNullifiers`

Fields:

```proto
rpc.NullifierList { repeated primitives.Digest nullifiers = 1; }
rpc.CheckNullifiersResponse { repeated primitives.SmtOpening proofs = 1; }
```

Verified command:

```bash
grpcurl -plaintext -import-path /pool0/miden-indexer/proto/proto -proto rpc.proto \
  -d '{"nullifiers":[{"d0":"0","d1":"0","d2":"0","d3":"0"}]}' \
  127.0.0.1:57291 rpc.Api/CheckNullifiers
```

Captured response:

```json
{
  "proofs": [
    {
      "path": { "emptyNodesMask": "18446744073709551615" },
      "leaf": { "emptyLeafIndex": "0" }
    }
  ]
}
```

Notes:

- The proof is positional: response proof `i` corresponds to request nullifier `i`.
- `emptyLeafIndex` is a non-inclusion proof for the requested nullifier.

### `GetNotesById`

Fields:

```proto
note.NoteIdList { repeated note.NoteId ids = 1; }
note.NoteId { primitives.Digest id = 1; }
note.CommittedNoteList { repeated note.CommittedNote notes = 1; }
note.CommittedNote {
  note.Note note = 1;
  note.NoteInclusionInBlockProof inclusion_proof = 2;
}
note.Note {
  note.NoteMetadata metadata = 1;
  optional bytes details = 2;
}
note.NoteMetadata {
  account.AccountId sender = 1;
  uint32 note_type = 2;
  fixed32 tag = 3;
  bytes attachment = 4;
}
note.NoteInclusionInBlockProof {
  note.NoteId note_id = 1;
  fixed32 block_num = 2;
  uint32 note_index_in_block = 3;
  primitives.SparseMerklePath inclusion_path = 4;
}
```

Verified command:

```bash
grpcurl -plaintext -import-path /pool0/miden-indexer/proto/proto -proto rpc.proto \
  -d '{"ids":[{"id":{"d0":"0","d1":"0","d2":"0","d3":"0"}}]}' \
  127.0.0.1:57291 rpc.Api/GetNotesById
```

Captured response for a non-existing zero note ID:

```json
{}
```

Notes:

- Empty `notes` is omitted by grpcurl JSON; generated clients should treat it as an empty array.
- Note details are `bytes` and appear as base64 when present.

## 4. Edge cases and gotchas

- JSON field names are lowerCamelCase (`blockNum`, `includeMmrProof`, `accountIds`, `noteTags`), even though proto fields are snake_case.
- `fixed64`/`uint64` values are emitted as JSON strings by grpcurl (`"2055530"`, `"18446744073709551615"`). Store as unsigned 64-bit capable types or decimal strings in TypeScript.
- `fixed32`/`uint32` values are emitted as JSON numbers. Block numbers are `fixed32`/`uint32`, not `uint64`.
- `bytes` fields are base64 in grpcurl JSON. This includes account IDs, raw blocks, validator keys, note attachments, code, and note details.
- Hashes/digests are not hex strings in the proto. They are `primitives.Digest { fixed64 d0, d1, d2, d3 }`.
- Empty digest values are omitted by grpcurl as `{}` because all four numeric fields are zero.
- Empty repeated fields are omitted by grpcurl JSON, not printed as `[]`.
- `GetLimits` from the live node returned: `CheckNullifiers.nullifier=1000`, `GetAccount.storage_map_key=64`, `GetNotesById.note_id=100`, `SyncNotes.note_tag=1000`, `SyncNullifiers.nullifier=1000`, `SyncState.account_id=1000`, `SyncState.note_tag=1000`.
- `SyncNullifiers.prefix_len` supports only `16` according to the proto comments.
- `BlockRange.block_to` is optional. For `SyncAccountVault` and `SyncAccountStorageMaps`, if `block_to` is supplied it must be close to chain tip (within 30 blocks per proto comments).
- `PaginationInfo.block_num` is the last checked block in a paginated response; continue from `block_num + 1`.
- `SyncState` has no pagination info; it advances from request `block_num + 1` to the next matching note block or the chain tip.
- Timestamps in `blockchain.BlockHeader.timestamp` are `fixed32` integer timestamps, not formatted strings.
- Deferred: public note/account decoding beyond proto-level fields requires decoding Miden `winter_utils::Serializable` byte payloads; the public proto does not expose fully decoded raw block contents.
